/**
 * Webhook.js — Telegram 웹훅 진입점. 시트 접근은 Ledger.js 함수만 쓴다.
 * doPost 는 어떤 경우에도 200 "ok" 를 돌려준다(Telegram 재시도 폭주 방지).
 */

/** 미분류 메시지의 파싱 결과를 잠시 보관하는 시간(초). */
var PENDING_TTL_SECONDS = 600;

/** 같은 update_id 를 다시 처리하지 않도록 기억하는 시간(초). 6시간. */
var UPDATE_DEDUPE_TTL_SECONDS = 21600;

/** 캐시가 비워졌을 때 Log 탭에서 되짚어 볼 행 수. */
var RECENT_LOG_LOOKBACK = 200;

/** 사용법 안내 3줄. */
var USAGE_TEXT = [
  '기록: "코스트코 85.89" 처럼 가맹점과 금액을 보내세요. "어제", "9/8", "5만원" 도 알아봅니다.',
  '조회: "얼마 남았어" 또는 "잔액" 을 보내면 봉투별 남은 금액을 알려드립니다.',
  '취소: "취소" 를 보내면 오늘 마지막으로 기록한 항목을 지웁니다.'
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
      return ContentService.createTextOutput('ok');
    }

    var update = JSON.parse(e.postData.contents);
    var updateId = update.update_id;

    // 두 번째 게이트: 같은 update_id 는 한 번만 처리한다.
    // Telegram 은 2xx 를 제때 받지 못하면 같은 update 를 재전송하는데,
    // 그대로 두면 Transactions 에 같은 행이 여러 개 쌓인다.
    var hasUpdateId = updateId !== null && updateId !== undefined &&
      String(updateId).trim() !== '';
    var cache = CacheService.getScriptCache();
    var dedupeKey = 'tg_update_' + updateId;
    var cacheHit = hasUpdateId && cache.get(dedupeKey) !== null;
    var recentLogIds = (hasUpdateId && !cacheHit)
      ? recentLogUpdateIds(RECENT_LOG_LOOKBACK)
      : [];
    if (isDuplicateUpdate(updateId, cacheHit, recentLogIds)) {
      return ContentService.createTextOutput('ok');
    }
    if (hasUpdateId) {
      // 처리 시작 전에 먼저 기록한다. 처리 도중 재전송이 와도 중복되지 않는다.
      cache.put(dedupeKey, '1', UPDATE_DEDUPE_TTL_SECONDS);
    }

    var message = update.message;
    var callback = update.callback_query;
    if (!message && !callback) {
      return ContentService.createTextOutput('ok');
    }

    var from = message ? message.from : callback.from;
    var userId = from && from.id;
    var allowed = getConfigList('allowed_telegram_ids');
    if (!userId || allowed.indexOf(String(userId)) < 0) {
      return ContentService.createTextOutput('ok');
    }

    if (message) {
      if (message.photo || (message.document && /^image\//.test(String(message.document.mime_type || '')))) {
        var photoLogRow = logEvent(userId, '[사진]', '', '수신', updateId);
        handleReceipt(message.chat.id, userId, message, photoLogRow);
        return ContentService.createTextOutput('ok');
      }
      var text = message.text || '';
      var logRow = logEvent(userId, text, '', '수신', updateId);
      handleMessage(message.chat.id, userId, text, message.message_id, logRow);
    } else {
      logEvent(userId, 'callback:' + callback.data, '', '수신', updateId);
      handleCallback(callback);
    }
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
 * 회신용 Telegram 호출 래퍼.
 * 시트 기록은 이미 끝난 뒤이므로, 회신이 실패해도 예외를 밖으로 내보내지 않는다.
 * 예외가 doPost 까지 올라가면 200 반환이 늦어져 Telegram 이 같은 update 를 재전송한다.
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
    fxUsdKrw: getConfigNumber('fx_usd_krw', 1332)
  };
}

/**
 * 텍스트 메시지를 처리한다.
 * @param {string|number} chatId
 * @param {string|number} userId
 * @param {string} text
 * @param {(string|number)=} messageId
 * @param {number=} logRow
 */
function handleMessage(chatId, userId, text, messageId, logRow) {
  var ctx = buildParseContext();
  var parsed = parseMessage(text, ctx);
  if (!parsed) {
    return;
  }
  updateLogResult(logRow, JSON.stringify(parsed), parsed.intent);

  if (parsed.intent === 'record') {
    handleRecord(chatId, userId, parsed, messageId, logRow);
    return;
  }
  if (parsed.intent === 'query') {
    var summary = buildQuerySummary(ctx.today);
    safeSend(chatId, summary);
    updateLogResult(logRow, JSON.stringify(parsed), '조회 응답');
    return;
  }
  if (parsed.intent === 'undo') {
    var target = lastActiveByUser(userId, ctx.today);
    if (!target) {
      safeSend(chatId, '취소할 항목 없음');
      updateLogResult(logRow, JSON.stringify(parsed), '취소 대상 없음');
      return;
    }
    softDelete(target.id, userId);
    safeSend(chatId, '↩︎ 취소했습니다: ' + target.merchant + ' ' +
      formatUsd(Number(target.amount_usd) || 0));
    updateLogResult(logRow, JSON.stringify(parsed), '취소 ' + target.id);
    return;
  }
  safeSend(chatId, USAGE_TEXT);
  updateLogResult(logRow, JSON.stringify(parsed), '사용법 안내');
}

/** 기록 의도를 처리한다. 사전에 없으면 봉투 선택 버튼을 보낸다. */
function handleRecord(chatId, userId, parsed, messageId, logRow) {
  var merchants = readAll(SHEETS.MERCHANTS.name);
  var cls = classify(parsed.merchantText, merchants);
  if (!cls && parsed.merchantTextRaw && parsed.merchantTextRaw !== parsed.merchantText) {
    // 수입 힌트(레슨 등)가 사전 키워드이기도 하므로 힌트 제거 전 문자열로 한 번 더 조회한다.
    cls = classify(parsed.merchantTextRaw, merchants);
  }

  if (!cls) {
    var pendingKey = String(chatId) + ':' + String(messageId || Date.now());
    CacheService.getScriptCache().put(pendingKey, JSON.stringify(parsed), PENDING_TTL_SECONDS);
    var choices = orderChoicesWithSuggestion(
      getConfigList('envelopes').concat(['고정비', '수입']),
      parsed.merchantTextRaw || parsed.merchantText,
      merchants
    );
    safeSend(
      chatId,
      '분류를 골라주세요: ' + (parsed.merchantTextRaw || '(가맹점 없음)') + ' ' +
        formatUsd(parsed.amount_usd || 0),
      buildChoiceKeyboard(pendingKey, choices)
    );
    updateLogResult(logRow, JSON.stringify(parsed), '분류 대기');
    return;
  }

  bumpMerchant(String(cls.keyword));
  var result = recordTransaction(parsed, cls, { userId: userId, source: 'telegram' });
  if (result.type === 'income') { recomputeIncomePct(parsed.date.slice(0, 7)); }
  var reply = buildRecordReply(parsed, result);
  if (parsed.confidence === 'low') {
    safeSend(chatId, reply + ' (확인 필요)', buildDeleteKeyboard(result.txId));
  } else {
    safeSend(chatId, reply);
  }
  updateLogResult(logRow, JSON.stringify(parsed), '기록 ' + result.txId);
}

/** 기록 결과 한 줄 회신문을 만든다. */
function buildRecordReply(parsed, result) {
  if (result.kind === 'fixed' || result.mode === 'confirm') {
    var line = '✓ ' + (result.name || '고정비') + ' ' + formatUsd(parsed.amount_usd) + ' 확정';
    if (result.expectedAmount) {
      line += ' (예상 ' + formatUsd(result.expectedAmount) + ')';
    }
    return line;
  }
  if (result.type === 'income') {
    return '✓ 수입 ' + formatUsd(parsed.amount_usd) + ' 기록' +
      (result.category ? ' · ' + result.category : '');
  }
  if (!result.envelope) {
    return '✓ ' + formatUsd(parsed.amount_usd) + ' 기록';
  }
  var status = envelopeStatus({
    budget: getBudgetAmount(parsed.date.slice(0, 7), result.envelope),
    transactions: monthTransactions(parsed.date.slice(0, 7)),
    envelope: result.envelope,
    today: todayStr()
  });
  return formatStatusLine(status, result.envelope);
}

/**
 * 조회 회신문. 유동비 봉투만 보여준다.
 * 고정비·부채·자산은 봇으로 회신하지 않는다(보안 경계).
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
  return lines.length ? lines.join('\n') : '봉투가 설정되지 않았습니다. Config.envelopes 를 확인하세요.';
}

/**
 * inline 버튼 콜백을 처리한다.
 * @param {!Object} cq callback_query
 */
function handleCallback(cq) {
  var data = String(cq.data || '');
  var chatId = cq.message && cq.message.chat ? cq.message.chat.id : null;
  var messageId = cq.message ? cq.message.message_id : null;
  var userId = cq.from.id;

  if (data.indexOf('cls|') === 0) {
    var parts = data.split('|');
    var pendingKey = parts[1];
    var choice = parts[2];
    var cached = CacheService.getScriptCache().get(pendingKey);
    if (!cached) {
      safeAnswer(cq.id, '시간이 지나 만료됐습니다. 다시 보내주세요.');
      return;
    }
    var parsed = JSON.parse(cached);
    var cls = buildClassFromChoice(choice, parsed);
    learnMerchant(parsed.merchantTextRaw || parsed.merchantText, cls);
    var result = recordTransaction(parsed, cls, { userId: userId, source: 'telegram' });
    if (result.type === 'income') { recomputeIncomePct(parsed.date.slice(0, 7)); }
    CacheService.getScriptCache().remove(pendingKey);
    if (chatId) {
      safeEdit(chatId, messageId, buildRecordReply(parsed, result));
    }
    logEvent(userId, 'callback:' + data, JSON.stringify(parsed), '기록 ' + result.txId);
    safeAnswer(cq.id, '기록했습니다');
    return;
  }

  if (data.indexOf('del|') === 0) {
    var txId = data.split('|')[1];
    var ok = softDelete(txId, userId);
    if (chatId) {
      safeEdit(chatId, messageId, ok ? '↩︎ 삭제했습니다.' : '이미 삭제된 항목입니다.');
    }
    logEvent(userId, 'callback:' + data, '', ok ? '삭제 ' + txId : '삭제 대상 없음');
    safeAnswer(cq.id, ok ? '삭제했습니다' : '대상을 찾지 못했습니다');
    return;
  }

  safeAnswer(cq.id);
}

/**
 * 분류 보조가 켜져 있으면 추천 봉투를 버튼 맨 앞으로 올린다.
 * 추천일 뿐이다. 기록은 사용자가 버튼을 눌러야 일어난다(Golden Rule 2).
 */
function orderChoicesWithSuggestion(choices, merchantText, merchants) {
  var suggestion = null;
  try {
    suggestion = suggestEnvelope(merchantText, choices, merchants);
  } catch (err) {
    logEvent('', 'llm', '', '추천 실패: ' + err);
  }
  if (!suggestion) {
    return choices;
  }
  return [suggestion].concat(choices.filter(function (c) { return c !== suggestion; }));
}

/** 버튼 선택값을 분류 객체로 바꾼다. */
function buildClassFromChoice(choice, parsed) {
  if (choice === '수입') {
    return { type: 'income', kind: 'variable', category: '기타 수입', envelope: '', recurring_id: '' };
  }
  if (choice === '고정비') {
    return { type: 'expense', kind: 'fixed', category: '고정비', envelope: '', recurring_id: '' };
  }
  return {
    type: parsed.type || 'expense',
    kind: 'variable',
    category: choice,
    envelope: choice,
    recurring_id: ''
  };
}
