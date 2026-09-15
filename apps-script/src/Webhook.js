/**
 * Webhook.js — Telegram 웹훅 진입점. 시트 접근은 Ledger.js 함수만 쓴다.
 * doPost 는 어떤 경우에도 200 "ok" 를 돌려준다(Telegram 재시도 폭주 방지).
 */

/** 버튼을 기다리는 파싱 결과를 캐시에 두는 시간(초). CacheService 최대치 6시간.
 *  만료돼도 Log 탭의 parsed_json 에서 복구하므로 사실상 만료가 없다. */
var PENDING_TTL_SECONDS = 21600;

/** 같은 update_id 를 다시 처리하지 않도록 기억하는 시간(초). 6시간. */
var UPDATE_DEDUPE_TTL_SECONDS = 21600;

/** 캐시가 비워졌을 때 Log 탭에서 되짚어 볼 행 수. */
var RECENT_LOG_LOOKBACK = 200;

/** 잠금을 기다리는 시간(ms). 중복 검사와 버튼 콜백에 쓴다. */
var DEDUPE_LOCK_WAIT_MS = 10000;

/** 봉투 외 선택지. 버튼 index 는 Config.envelopes + 이 배열 순서다. */
var EXTRA_CHOICES = ['고정비', '수입'];

/** Log 의 result 가 이 중 하나로 시작하면 parsed_json 을 대기 항목으로 복구해도 된다. */
var PENDING_RESULTS = ['분류 대기', '금액 확인', '영수증 분류 대기'];

/** 사용법 안내. */
var USAGE_TEXT = [
  '기록: "코스트코 85.89" 처럼 가맹점과 금액을 보내세요. "어제", "9/8", "5만원" 도 알아봅니다.',
  '환불: "환불 코스트코 20" 은 같은 봉투에서 빼 줍니다.',
  '조회: "얼마 남았어" 또는 "잔액" 을 보내면 봉투별 남은 금액을 알려드립니다.',
  '이동: "이동 예비비→식료품 50" 으로 이번 달 예산을 옮깁니다.',
  '취소: "취소" 를 보내면 마지막으로 기록한 항목을 되돌립니다.'
].join('\n');

/**
 * Telegram 웹훅 엔드포인트.
 * @param {!Object} e Apps Script 웹앱 이벤트
 * @return {!TextOutput} 항상 'ok'
 */
function doPost(e) {
  try {
    // 첫 번째 검사: URL 파라미터의 token 이 WEBHOOK_SECRET 과 같아야 한다.
    // Apps Script 는 요청 헤더를 읽을 수 없으므로 secret 을 URL 로만 검증한다.
    if (!e || !e.parameter || e.parameter.token !== getSecret('WEBHOOK_SECRET')) {
      // 조용히 버리면 "왜 회신이 없지" 를 진단할 수 없다. 다만 배포 URL 은 외부에서도
      // 두드릴 수 있으므로 한 시간에 한 줄만 남긴다.
      noteRejectionOnce('token', 'token 불일치 또는 없음. setWebhook 을 다시 실행하세요.');
      return ContentService.createTextOutput('ok');
    }

    processUpdate(JSON.parse(e.postData.contents));
  } catch (err) {
    try {
      logEvent('', 'doPost 예외', '', String(err && err.stack ? err.stack : err));
    } catch (ignored) {
      Logger.log('doPost 예외: ' + err);
    }
  }
  return ContentService.createTextOutput('ok');
}

/**
 * Telegram update 하나를 처리한다.
 *
 * 웹훅(doPost)과 밀린 건 복구(drainPendingUpdates)가 같은 길을 쓴다.
 * 어느 쪽으로 들어오든 claimUpdate 가 같은 update 를 두 번 처리하지 않게 막는다.
 *
 * @param {!Object} update Telegram update 객체
 * @return {boolean} 이 호출이 실제로 처리했으면 true
 */
function processUpdate(update) {
  if (!update) {
    return false;
  }
  var updateId = update.update_id;

  // 같은 update_id 는 한 번만 처리한다.
  // Telegram 은 2xx 를 제때 받지 못하면 같은 update 를 재전송하는데,
  // 그대로 두면 Transactions 에 같은 행이 여러 개 쌓인다.
  if (!claimUpdate(updateId)) {
    return false;
  }

  var message = update.message;
  var callback = update.callback_query;
  if (!message && !callback) {
    logEvent('', '[무시]', '', 'message 도 callback 도 아닌 update', updateId);
    return false;
  }

  var from = message ? message.from : callback.from;
  var userId = from && from.id;
  var allowed = getConfigList('allowed_telegram_ids');
  if (!userId || allowed.indexOf(String(userId)) < 0) {
    // 여기까지 왔다는 것은 token 은 맞았다는 뜻이다. Config.allowed_telegram_ids 에
    // 넣을 실제 id 를 Log 에 남겨 두면 오타를 바로 찾을 수 있다.
    logEvent(userId, message ? (message.text || '[사진]') : 'callback:' + callback.data, '',
      '거부: Config.allowed_telegram_ids 에 없는 id (' + userId + ')', updateId);
    return false;
  }

  if (message) {
    if (message.photo || (message.document && /^image\//.test(String(message.document.mime_type || '')))) {
      var photoLogRow = logEvent(userId, '[사진]', '', '수신', updateId);
      handleReceipt(message.chat.id, userId, message, photoLogRow);
      return true;
    }
    var text = message.text || '';
    var logRow = logEvent(userId, text, '', '수신', updateId);
    handleMessage(message.chat.id, userId, text, logRow);
    return true;
  }
  logEvent(userId, 'callback:' + callback.data, '', '수신', updateId);
  handleCallback(callback);
  return true;
}

/**
 * 이 update 를 처리할 권리를 딱 한 실행만 갖게 한다.
 *
 * 순서가 중요하다.
 *   1) 스크립트 잠금을 잡는다. 같은 update 의 재전송이 동시에 들어와도 한 번에 하나만 여기를 지난다.
 *   2) 캐시를 본다. 있으면 중복이다.
 *   3) 없으면 즉시 캐시에 적는다. 느린 작업(Log 읽기) 전에 적어야 그 사이에 끼어드는 재전송이 걸린다.
 *   4) 잠금을 푼 뒤에 Log 탭으로 2차 확인한다. 캐시가 비워졌을 때를 위한 안전망이다.
 *
 * @param {(string|number|null|undefined)} updateId
 * @return {boolean} true 면 이 실행이 처리한다. false 면 이미 처리 중이거나 처리됐다.
 */
function claimUpdate(updateId) {
  var hasUpdateId = updateId !== null && updateId !== undefined &&
    String(updateId).trim() !== '';
  if (!hasUpdateId) {
    return true; // update_id 가 없으면 멱등 판정을 할 수 없으므로 정상 처리한다
  }

  var cache = CacheService.getScriptCache();
  var dedupeKey = 'tg_update_' + updateId;
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(DEDUPE_LOCK_WAIT_MS);
    if (!locked) {
      logEvent('', 'dedupe', '', '잠금 대기 초과, 건너뜀 update_id=' + updateId);
      return false;
    }
    if (cache.get(dedupeKey) !== null) {
      return false;
    }
    cache.put(dedupeKey, '1', UPDATE_DEDUPE_TTL_SECONDS);
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }

  var recentLogIds = recentLogUpdateIds(RECENT_LOG_LOOKBACK);
  return !isDuplicateUpdate(updateId, false, recentLogIds);
}

/**
 * 요청을 거부한 사실을 Log 탭에 남긴다. 같은 사유는 한 시간에 한 번만 남긴다.
 * 배포 URL 은 누구나 두드릴 수 있어 매번 남기면 Log 탭이 잡음으로 찬다.
 * @param {string} reasonKey 사유 구분자
 * @param {string} message Log 의 result 에 적을 설명
 */
function noteRejectionOnce(reasonKey, message) {
  try {
    var cache = CacheService.getScriptCache();
    var key = 'reject_' + reasonKey;
    if (cache.get(key) !== null) {
      return;
    }
    cache.put(key, '1', 3600);
    logEvent('', '[거부]', '', '거부: ' + message);
  } catch (err) {
    Logger.log('거부 기록 실패: ' + err);
  }
}

/**
 * 회신용 Telegram 호출 래퍼.
 * 시트 기록은 이미 끝난 뒤이므로, 회신이 실패해도 예외를 밖으로 내보내지 않는다.
 */
function safeSend(chatId, text, replyMarkup) {
  try {
    return sendMessage(chatId, text, replyMarkup);
  } catch (err) {
    logEvent('', 'sendMessage 실패', '', String(err));
    return null;
  }
}

/** editMessageText 의 안전 래퍼. */
function safeEdit(chatId, messageId, text, replyMarkup) {
  try {
    return editMessageText(chatId, messageId, text, replyMarkup);
  } catch (err) {
    logEvent('', 'editMessageText 실패', '', String(err));
    return null;
  }
}

/** answerCallbackQuery 의 안전 래퍼. */
function safeAnswer(callbackQueryId, text) {
  try {
    return answerCallbackQuery(callbackQueryId, text);
  } catch (err) {
    logEvent('', 'answerCallbackQuery 실패', '', String(err));
    return null;
  }
}

/** Parser 에 넘길 실행 컨텍스트. */
function buildParseContext() {
  return {
    today: todayStr(),
    defaultCurrency: getConfig('default_currency', 'USD'),
    fxUsdKrw: getConfigNumber('fx_usd_krw', 1332),
    incomeHints: getConfigList('income_hints')
  };
}

/** 버튼 선택지의 표준 순서. index 가 이 배열 기준이라 LLM 이 표시 순서를 바꿔도 안전하다. */
function canonicalChoices() {
  return getConfigList('envelopes').concat(EXTRA_CHOICES);
}

/** 버튼을 기다리는 파싱 결과를 보관한다. 키는 Log 행 번호다. */
function putPending(logRow, parsed) {
  CacheService.getScriptCache().put('p' + logRow, JSON.stringify(parsed), PENDING_TTL_SECONDS);
}

/** 대기 항목을 지운다. 기록 전에 지워야 연타나 동시 클릭이 두 번 기록하지 않는다. */
function removePending(logRow) {
  CacheService.getScriptCache().remove('p' + logRow);
}

/**
 * 대기 항목을 꺼낸다. 캐시에 없으면 Log 탭의 parsed_json 에서 복구한다.
 * @param {(string|number)} logRow
 * @return {?Object}
 */
function getPending(logRow) {
  var raw = CacheService.getScriptCache().get('p' + logRow);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }
  var row = readLogRow(Number(logRow));
  if (!row || !row.parsed_json) {
    return null;
  }
  var ok = PENDING_RESULTS.some(function (p) { return row.result.indexOf(p) === 0; });
  if (!ok) {
    return null; // 이미 처리됐거나 대기 항목이 아니다
  }
  try {
    return JSON.parse(row.parsed_json);
  } catch (err2) {
    return null;
  }
}

/**
 * 텍스트 메시지를 처리한다.
 * @param {string|number} chatId
 * @param {string|number} userId
 * @param {string} text
 * @param {number=} logRow
 */
function handleMessage(chatId, userId, text, logRow) {
  var ctx = buildParseContext();
  var parsed = parseMessage(text, ctx);
  if (!parsed) {
    return;
  }
  updateLogResult(logRow, JSON.stringify(parsed), parsed.intent);

  if (parsed.intent === 'record') {
    ensureMonthOpened(parsed.date.slice(0, 7));
    handleRecord(chatId, userId, parsed, logRow);
    return;
  }
  if (parsed.intent === 'query') {
    ensureMonthOpened(ctx.today.slice(0, 7));
    safeSend(chatId, buildQuerySummary(ctx.today));
    updateLogResult(logRow, JSON.stringify(parsed), '조회 응답');
    return;
  }
  if (parsed.intent === 'undo') {
    var undone = undoLast(userId);
    if (!undone) {
      safeSend(chatId, '취소할 최근 기록이 없습니다. 웹앱 원장에서 지워주세요.');
      updateLogResult(logRow, JSON.stringify(parsed), '취소 대상 없음');
      return;
    }
    var label = String(undone.row.merchant || '') + ' ' + formatUsd(Number(undone.row.amount_usd) || 0);
    safeSend(chatId, undone.action === 'revert'
      ? '↩︎ 확정을 되돌렸습니다: ' + label + ' → 예정으로'
      : '↩︎ 취소했습니다: ' + label);
    updateLogResult(logRow, JSON.stringify(parsed), '취소 ' + undone.row.id);
    return;
  }
  if (parsed.intent === 'move') {
    try {
      var moved = moveBudget(ctx.today.slice(0, 7), parsed.moveFrom, parsed.moveTo, parsed.amount_usd);
      safeSend(chatId, '↔ ' + moved.from + ' → ' + moved.to + ' ' + formatUsd(parsed.amount_usd) + ' 옮겼습니다.\n' +
        moved.from + ' 예산 ' + formatUsd(moved.fromAmount) + ' · ' + moved.to + ' 예산 ' + formatUsd(moved.toAmount));
      updateLogResult(logRow, JSON.stringify(parsed), '이동 ' + moved.from + '→' + moved.to);
    } catch (err) {
      safeSend(chatId, '옮기지 못했습니다: ' + err.message);
      updateLogResult(logRow, JSON.stringify(parsed), '이동 실패 ' + err.message);
    }
    return;
  }
  safeSend(chatId, USAGE_TEXT);
  updateLogResult(logRow, JSON.stringify(parsed), '사용법 안내');
}

/** Recurring 정의를 classify() 결과 모양으로 바꾼다. */
function classFromDefinition(def) {
  return {
    keyword: String(def.name),
    type: recurringType(def),
    kind: String(def.kind || 'fixed').trim(),
    category: String(def.category || ''),
    envelope: '',
    recurring_id: String(def.id).trim()
  };
}

/**
 * 기록 의도를 처리한다.
 * 금액이 애매하면 금액 버튼을, 사전에 없으면 봉투 버튼을 보낸다. 둘 다 Log 행 번호로 이어진다.
 */
function handleRecord(chatId, userId, parsed, logRow) {
  if (parsed.ambiguous && parsed.amountCandidates && parsed.amountCandidates.length > 1) {
    putPending(logRow, parsed);
    var labels = parsed.amountCandidates.map(function (c) {
      return c.currency === 'KRW' ? Math.round(c.amount) + '원' : formatUsd(c.amount);
    });
    safeSend(chatId, '금액이 어느 것인가요? ' + (parsed.merchantTextRaw || ''),
      buildIndexKeyboard('amt', logRow, labels, null, 3));
    updateLogResult(logRow, JSON.stringify(parsed), '금액 확인');
    return;
  }

  var merchants = readAllCached(SHEETS.MERCHANTS.name);
  var cls = classify(parsed.merchantText, merchants);
  if (!cls && parsed.merchantTextRaw && parsed.merchantTextRaw !== parsed.merchantText) {
    // 수입 힌트(레슨 등)가 사전 키워드이기도 하므로 힌트 제거 전 문자열로 한 번 더 조회한다.
    cls = classify(parsed.merchantTextRaw, merchants);
  }
  if (!cls) {
    // 사전에 없어도 Recurring 고정 항목 이름이 그대로 들어 있으면 그 항목을 확정한다.
    var def = matchRecurringName(parsed.merchantTextRaw || parsed.merchantText, activeRecurring());
    if (def) {
      cls = classFromDefinition(def);
    }
  }

  if (!cls) {
    putPending(logRow, parsed);
    var choices = canonicalChoices();
    var prompt = '분류를 골라주세요: ' + (parsed.merchantTextRaw || '(가맹점 없음)') + ' ' +
      formatUsd(parsed.amount_usd || 0);
    // 버튼을 먼저 보내고, 추천은 나중에 순서만 바꾼다. 사람이 LLM 을 기다리지 않게.
    var sent = safeSend(chatId, prompt, buildIndexKeyboard('cls', logRow, choices));
    updateLogResult(logRow, JSON.stringify(parsed), '분류 대기');
    var suggestion = null;
    try {
      suggestion = suggestEnvelope(parsed.merchantTextRaw || parsed.merchantText, choices, merchants);
    } catch (err) {
      logEvent('', 'llm', '', '추천 실패: ' + err);
    }
    var messageId = sent && sent.result ? sent.result.message_id : null;
    if (suggestion && messageId && choices.indexOf(suggestion) > 0) {
      var order = [choices.indexOf(suggestion)].concat(
        choices.map(function (_c, i) { return i; }).filter(function (i) { return choices[i] !== suggestion; })
      );
      safeEdit(chatId, messageId, prompt + '\n추천: ' + suggestion, buildIndexKeyboard('cls', logRow, choices, order));
    }
    return;
  }

  if (cls.keyword) {
    bumpMerchant(String(cls.keyword));
  }
  finishRecord(chatId, userId, parsed, cls, logRow, null);
}

/**
 * 분류가 정해진 뒤의 공통 마무리: 기록 → 회신 → Log.
 * @param {?Object} editTarget {chatId, messageId} 가 있으면 새 메시지 대신 그 메시지를 수정한다
 */
function finishRecord(chatId, userId, parsed, cls, logRow, editTarget) {
  var result = recordTransaction(parsed, cls, { userId: userId, source: 'telegram' });
  if (result.type === 'income') {
    recomputeIncomePct(parsed.date.slice(0, 7));
  }
  var reply = buildRecordReply(parsed, result);
  var text = reply.text;
  var keyboard = reply.keyboard;
  if (parsed.confidence === 'low' && result.mode !== 'confirm') {
    text += ' (확인 필요)';
    keyboard = keyboard || buildDeleteKeyboard(result.txId);
  }
  if (editTarget && editTarget.messageId) {
    safeEdit(editTarget.chatId, editTarget.messageId, text, keyboard);
  } else {
    safeSend(chatId, text, keyboard);
  }
  var tag = result.mode === 'confirm' ? '확정 ' : (result.mode === 'refund' ? '환불 ' : '기록 ');
  updateLogResult(logRow, JSON.stringify(parsed), tag + result.txId);
  return result;
}

/**
 * 기록 결과 회신문. 봉투 지출이면 상태 한 줄, 빨강이면 예비비 이동 버튼을 붙인다.
 * @return {{text: string, keyboard: ?Object}}
 */
function buildRecordReply(parsed, result) {
  if (result.mode === 'confirm') {
    var verb = result.type === 'income' ? '입금' : '확정';
    var line = '✓ ' + (result.name || '고정 항목') + ' ' + formatUsd(parsed.amount_usd) + ' ' + verb;
    if (result.nth > 1) {
      line += ' (이번 달 ' + result.nth + '번째)';
    } else if (result.expectedAmount) {
      line += ' (예상 ' + formatUsd(toUsd(result.expectedAmount, result.expectedCurrency || 'USD')) + ')';
    }
    if (result.debt) {
      line += '\n' + result.debt.name + ' 원금 ' + formatAmountIn(result.debt.principal, result.debt.currency) +
        ' (이자 ' + formatAmountIn(result.debt.interest, result.debt.currency) + ')';
    }
    return { text: line, keyboard: null };
  }
  if (result.type === 'income') {
    return {
      text: '✓ 수입 ' + formatUsd(parsed.amount_usd) + ' 기록' + (result.category ? ' · ' + result.category : ''),
      keyboard: null
    };
  }
  if (result.type === 'transfer') {
    return { text: '✓ 저축 ' + formatUsd(parsed.amount_usd) + ' 기록', keyboard: null };
  }
  if (!result.envelope) {
    return { text: '✓ ' + formatUsd(parsed.amount_usd) + ' 기록', keyboard: null };
  }
  // 지난 달 지출을 뒤늦게 적는 경우가 있다. 그때는 "오늘 남은" 이 뜻이 없으므로
  // 그 달 말일 기준으로 결산해 보여 준다. 기준일을 today 로 두면 그 달 지출이 하나도 안 잡힌다.
  var month = parsed.date.slice(0, 7);
  var today = todayStr();
  var isCurrentMonth = month === today.slice(0, 7);
  var status = envelopeStatus({
    budget: getBudgetAmount(month, result.envelope),
    transactions: monthTransactions(month),
    envelope: result.envelope,
    today: isCurrentMonth ? today : month + '-' + daysInMonth(month)
  });
  var prefix = result.mode === 'refund' ? '↩︎ 환불 ' + formatUsd(Math.abs(parsed.amount_usd)) + '\n' : '';
  if (!isCurrentMonth) {
    return {
      text: prefix + '✓ ' + month + ' ' + result.envelope + ' ' + formatUsd(parsed.amount_usd) + ' 기록\n' +
        signalGlyph(status.signal) + ' ' + month + ' 실행 ' + formatUsd(status.spentTotal) +
        ' / 예산 ' + formatUsd(status.budget) + ' · 잔액 ' + formatUsd(status.remaining),
      keyboard: null
    };
  }
  return {
    text: prefix + formatStatusLine(status, result.envelope),
    keyboard: overspendKeyboard(month, result.envelope, status)
  };
}

/** 통화에 맞춘 금액 표기. KRW 는 원 단위 정수. */
function formatAmountIn(amount, currency) {
  if (String(currency).toUpperCase() === 'KRW') {
    return Math.round(Number(amount) || 0).toLocaleString('en-US') + '원';
  }
  return formatUsd(amount);
}

/**
 * 봉투가 빨강이면 "예비비에서 $N 옮기기" 버튼을 만든다. 예비비에 여유가 없으면 없다.
 * @return {?Object}
 */
function overspendKeyboard(month, envelope, status) {
  if (status.signal !== 'red') {
    return null;
  }
  if (month !== currentMonthStr()) {
    return null; // 예산 이동은 이번 달만. 버튼 콜백이 이번 달 Budgets 를 고치기 때문이다.
  }
  var envelopes = getConfigList('envelopes');
  var from = getConfig('overspend_envelope', '');
  var fromIdx = envelopes.indexOf(from);
  var toIdx = envelopes.indexOf(envelope);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
    return null;
  }
  var fromRemaining = getBudgetAmount(month, from) -
    envelopeStatus({ budget: getBudgetAmount(month, from), transactions: monthTransactions(month), envelope: from, today: todayStr() }).spentTotal;
  var need = status.remaining < 0 ? -status.remaining : Math.max(-status.deltaVsPlan, 0);
  var amount = Math.min(Math.ceil(need / 10) * 10 || 10, Math.floor(fromRemaining));
  if (!(amount > 0)) {
    return null;
  }
  return buildMoveKeyboard(fromIdx, toIdx, amount, from + '에서 ' + formatUsd(amount) + ' 옮기기');
}

/**
 * 조회 회신문. 유동비 봉투와 저축만 보여준다.
 * 고정비 상세·부채·자산은 봇으로 회신하지 않는다(보안 경계).
 */
function buildQuerySummary(today) {
  var month = today.slice(0, 7);
  var transactions = monthTransactions(month);
  var lines = getConfigList('envelopes').map(function (envelope) {
    var status = envelopeStatus({
      budget: getBudgetAmount(month, envelope),
      transactions: transactions,
      envelope: envelope,
      today: today
    });
    return formatStatusLine(status, envelope);
  });
  if (!lines.length) {
    return '봉투가 설정되지 않았습니다. Config.envelopes 를 확인하세요.';
  }
  var savings = savingsPlan(month);
  if (savings.expected > 0) {
    lines.push('💰 저축 ' + formatUsd(savings.actual) + ' / ' + formatUsd(savings.expected));
  }
  return lines.join('\n');
}

/**
 * inline 버튼 콜백을 처리한다. 잠금 안에서 돌아 연타·동시 클릭이 두 번 기록하지 않게 한다.
 * @param {!Object} cq callback_query
 */
function handleCallback(cq) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    locked = lock.tryLock(DEDUPE_LOCK_WAIT_MS);
    if (!locked) {
      safeAnswer(cq.id, '처리 중입니다. 잠시 뒤 다시 눌러주세요.');
      return;
    }
    handleCallbackLocked(cq);
  } finally {
    if (locked) {
      lock.releaseLock();
    }
  }
}

function handleCallbackLocked(cq) {
  var data = String(cq.data || '');
  var chatId = cq.message && cq.message.chat ? cq.message.chat.id : null;
  var messageId = cq.message ? cq.message.message_id : null;
  var userId = cq.from.id;
  var parts = data.split('|');
  var kind = parts[0];

  if (kind === 'cls' || kind === 'amt') {
    var logRow = Number(parts[1]);
    var idx = Number(parts[2]);
    var parsed = getPending(logRow);
    if (!parsed) {
      safeAnswer(cq.id, '이미 처리됐거나 찾을 수 없습니다. 다시 보내주세요.');
      if (chatId) {
        safeEdit(chatId, messageId, (cq.message.text || '') + '\n(만료)');
      }
      return;
    }
    removePending(logRow); // 기록 전에 지운다. 두 번 눌러도 한 번만 기록된다.

    if (kind === 'amt') {
      var cand = parsed.amountCandidates && parsed.amountCandidates[idx];
      if (!cand) {
        safeAnswer(cq.id, '금액을 찾지 못했습니다.');
        return;
      }
      var sign = parsed.refund ? -1 : 1;
      var fx = getConfigNumber('fx_usd_krw', 1332);
      parsed.amount = round2(sign * cand.amount);
      parsed.currency = cand.currency;
      parsed.amount_usd = cand.currency === 'KRW' ? round2(sign * cand.amount / fx) : round2(sign * cand.amount);
      parsed.ambiguous = false;
      parsed.confidence = parsed.merchantText ? 'high' : 'low';
      parsed.memo = parsed.confidence === 'low' ? parsed.memo : '';
      if (chatId) {
        safeEdit(chatId, messageId, '금액 ' + formatUsd(parsed.amount_usd) + ' 확인');
      }
      safeAnswer(cq.id);
      updateLogResult(logRow, JSON.stringify(parsed), 'record');
      handleRecord(chatId, userId, parsed, logRow);
      return;
    }

    var choice = canonicalChoices()[idx];
    if (!choice) {
      safeAnswer(cq.id, '선택지를 찾지 못했습니다.');
      return;
    }
    var cls = buildClassFromChoice(choice, parsed);
    learnMerchant(parsed.merchantTextRaw || parsed.merchantText, cls);
    finishRecord(chatId, userId, parsed, cls, logRow, { chatId: chatId, messageId: messageId });
    safeAnswer(cq.id, '기록했습니다');
    return;
  }

  if (kind === 'del') {
    var txId = parts[1];
    var ok = softDelete(txId, userId);
    if (chatId) {
      safeEdit(chatId, messageId, ok ? '↩︎ 삭제했습니다.' : '이미 삭제된 항목입니다.');
    }
    logEvent(userId, 'callback:' + data, '', ok ? '삭제 ' + txId : '삭제 대상 없음');
    safeAnswer(cq.id, ok ? '삭제했습니다' : '대상을 찾지 못했습니다');
    return;
  }

  if (kind === 'mv') {
    var envelopes = getConfigList('envelopes');
    var from = envelopes[Number(parts[1])];
    var to = envelopes[Number(parts[2])];
    var amount = Number(parts[3]);
    try {
      var moved = moveBudget(currentMonthStr(), from, to, amount);
      if (chatId) {
        safeEdit(chatId, messageId, (cq.message.text || '') + '\n↔ ' + from + ' → ' + to + ' ' + formatUsd(amount) +
          ' 옮김 · ' + to + ' 예산 ' + formatUsd(moved.toAmount));
      }
      logEvent(userId, 'callback:' + data, '', '이동 ' + from + '→' + to + ' ' + amount);
      safeAnswer(cq.id, '옮겼습니다');
    } catch (err) {
      logEvent(userId, 'callback:' + data, '', '이동 실패 ' + err.message);
      safeAnswer(cq.id, '옮기지 못했습니다: ' + err.message);
    }
    return;
  }

  safeAnswer(cq.id);
}

/** 버튼 선택값을 분류 객체로 바꾼다. 봉투를 골랐으면 언제나 유동비 지출이다. */
function buildClassFromChoice(choice, parsed) {
  if (choice === '수입') {
    return { type: 'income', kind: 'variable', category: '기타 수입', envelope: '', recurring_id: '' };
  }
  if (choice === '고정비') {
    return { type: 'expense', kind: 'fixed', category: '고정비', envelope: '', recurring_id: '' };
  }
  return {
    type: 'expense',
    kind: 'variable',
    category: choice,
    envelope: choice,
    recurring_id: ''
  };
}
