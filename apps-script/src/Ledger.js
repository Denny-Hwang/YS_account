/**
 * Ledger.js — 원장 쓰기와 조회. Webhook.js 는 시트를 직접 만지지 않고 이 함수들만 호출한다.
 * 원장은 append-only + soft delete 다. 행을 물리 삭제하지 않는다(Golden Rule 3).
 * 어느 행을 손댈지 정하는 규칙은 LedgerRules.js(순수 모듈)에 있고 여기서는 시트 입출력만 한다.
 */

/** 사용자별 "마지막 기록" 을 기억하는 시간(초). 6시간. 되돌리기(취소)에 쓴다. */
var LAST_TX_TTL_SECONDS = 21600;

/** Log 탭에서 마지막 기록을 되짚어 볼 행 수. 캐시가 비워졌을 때의 안전망. */
var LAST_TX_LOG_LOOKBACK = 300;

/**
 * Log 탭에 한 줄 남기고 행 번호를 돌려준다.
 * @param {(string|number)} telegramId
 * @param {string} rawText
 * @param {string} parsedJson
 * @param {string} result
 * @param {(string|number)=} updateId Telegram update_id. 재전송 판별에 쓴다.
 * @return {number} 행 번호. 실패하면 -1.
 */
function logEvent(telegramId, rawText, parsedJson, result, updateId) {
  try {
    var sheet = getSheet(SHEETS.LOG.name);
    sheet.appendRow([
      nowIso(),
      telegramId === null || telegramId === undefined ? '' : String(telegramId),
      rawText === null || rawText === undefined ? '' : String(rawText),
      parsedJson === null || parsedJson === undefined ? '' : String(parsedJson),
      result === null || result === undefined ? '' : String(result),
      updateId === null || updateId === undefined ? '' : String(updateId)
    ]);
    return sheet.getLastRow();
  } catch (err) {
    Logger.log('Log 기록 실패: ' + err);
    return -1;
  }
}

/**
 * Log 탭 최근 행의 update_id 목록을 읽는다.
 * CacheService 가 비워졌을 때 재전송을 걸러내는 두 번째 방어선이다.
 * @param {number} limit 되짚어 볼 행 수
 * @return {!Array<(string|number)>}
 */
function recentLogUpdateIds(limit) {
  try {
    var headers = readHeaders(SHEETS.LOG.name);
    var col = headers.indexOf('update_id') + 1;
    if (col < 1) {
      return []; // 아직 update_id 열이 없는 시트. setupSheet 이 추가한다.
    }
    var sheet = getSheet(SHEETS.LOG.name);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return [];
    }
    var count = Math.min(Number(limit) || 0, lastRow - 1);
    if (count < 1) {
      return [];
    }
    return sheet.getRange(lastRow - count + 1, col, count, 1).getValues()
      .map(function (row) { return row[0]; });
  } catch (err) {
    Logger.log('Log update_id 조회 실패: ' + err);
    return [];
  }
}

/** 이미 남긴 Log 행의 parsed_json 과 result 를 채운다. */
function updateLogResult(rowNum, parsedJson, result) {
  if (!rowNum || rowNum < 2) {
    return;
  }
  try {
    var sheet = getSheet(SHEETS.LOG.name);
    sheet.getRange(rowNum, 4, 1, 2).setValues([[
      parsedJson === null || parsedJson === undefined ? '' : String(parsedJson),
      result === null || result === undefined ? '' : String(result)
    ]]);
  } catch (err) {
    Logger.log('Log 갱신 실패: ' + err);
  }
}

/**
 * Log 행 하나를 읽는다. 분류 버튼이 늦게 눌려 캐시가 비었을 때 parsed_json 을 복구하는 데 쓴다.
 * @param {number} rowNum
 * @return {?{telegram_id: string, raw_text: string, parsed_json: string, result: string}}
 */
function readLogRow(rowNum) {
  if (!rowNum || rowNum < 2) {
    return null;
  }
  try {
    var sheet = getSheet(SHEETS.LOG.name);
    if (rowNum > sheet.getLastRow()) {
      return null;
    }
    var v = sheet.getRange(rowNum, 1, 1, 5).getValues()[0];
    return {
      telegram_id: String(v[1] || ''),
      raw_text: String(v[2] || ''),
      parsed_json: String(v[3] || ''),
      result: String(v[4] || '')
    };
  } catch (err) {
    Logger.log('Log 행 읽기 실패: ' + err);
    return null;
  }
}

/**
 * Log 탭에서 이 사용자의 마지막 기록 tx id 를 찾는다. 캐시가 비워졌을 때의 안전망이다.
 * result 열이 "기록 tx_…", "확정 tx_…", "환불 tx_…" 인 행을 아래에서부터 본다.
 * @param {(string|number)} userId
 * @return {?string}
 */
function lastRecordedTxFromLog(userId) {
  try {
    var sheet = getSheet(SHEETS.LOG.name);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return null;
    }
    var count = Math.min(LAST_TX_LOG_LOOKBACK, lastRow - 1);
    var values = sheet.getRange(lastRow - count + 1, 2, count, 4).getValues();
    var uid = String(userId);
    for (var i = values.length - 1; i >= 0; i--) {
      if (String(values[i][0]).trim() !== uid) {
        continue;
      }
      var m = /^(기록|확정|환불) (tx_\S+)/.exec(String(values[i][3] || ''));
      if (m) {
        return m[2];
      }
      if (/^(취소|삭제) /.test(String(values[i][3] || ''))) {
        return null; // 마지막 행위가 취소였다면 더 이전 것을 또 지우지 않는다
      }
    }
  } catch (err) {
    Logger.log('Log 마지막 기록 조회 실패: ' + err);
  }
  return null;
}

/** 사용자의 마지막 기록을 캐시에 남긴다. 취소가 정확히 그 행을 되돌리게 한다. */
function rememberLastTx(userId, memo) {
  try {
    CacheService.getScriptCache().put('last_tx_' + String(userId), JSON.stringify(memo), LAST_TX_TTL_SECONDS);
  } catch (err) {
    Logger.log('last_tx 캐시 실패: ' + err);
  }
}

/** 사용자의 마지막 기록 메모. 없으면 null. */
function recallLastTx(userId) {
  var raw = CacheService.getScriptCache().get('last_tx_' + String(userId));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/** 사용자의 마지막 기록 메모를 지운다. 취소 뒤에 또 취소해도 다른 행을 건드리지 않게. */
function forgetLastTx(userId) {
  CacheService.getScriptCache().remove('last_tx_' + String(userId));
}

/** Telegram user id 를 사람 이름으로 바꾼다. Config 의 `name_<id>` 키를 본다. */
function payerName(userId) {
  var name = getConfig('name_' + String(userId), '');
  return name || String(userId);
}

/** 해당 월·세부예산의 예산 금액. 없으면 0. */
function getBudgetAmount(month, envelope) {
  var rows = readAllCached(SHEETS.BUDGETS.name);
  for (var i = 0; i < rows.length; i++) {
    if (toMonthStr(rows[i].month) === month &&
        String(rows[i].envelope).trim() === String(envelope).trim()) {
      return Number(rows[i].amount) || 0;
    }
  }
  return 0;
}

/** 해당 월의 원장 행 전체(날짜는 YYYY-MM-DD 문자열로 정규화). 한 실행 안에서는 캐시된다. */
function monthTransactions(month) {
  return readAllCached(SHEETS.TRANSACTIONS.name)
    .map(function (row) {
      row.date = toDateStr(row.date);
      return row;
    })
    .filter(function (row) {
      return String(row.date).slice(0, 7) === month;
    });
}

/** 사전에 매칭될 때마다 hit_count 를 올리고 last_used 를 갱신한다. */
function bumpMerchant(keyword) {
  var sheet = getSheet(SHEETS.MERCHANTS.name);
  var headers = readHeaders(SHEETS.MERCHANTS.name);
  var rowNum = findRowById(SHEETS.MERCHANTS.name, keyword, 'keyword');
  if (rowNum < 0) {
    return;
  }
  var hitCol = headers.indexOf('hit_count') + 1;
  var lastCol = headers.indexOf('last_used') + 1;
  if (hitCol > 0) {
    var current = Number(sheet.getRange(rowNum, hitCol).getValue()) || 0;
    sheet.getRange(rowNum, hitCol).setValue(current + 1);
  }
  if (lastCol > 0) {
    sheet.getRange(rowNum, lastCol).setValue(nowIso());
  }
  invalidateReadCache(SHEETS.MERCHANTS.name);
}

/** 사용자가 버튼으로 고른 분류를 사전에 학습시킨다. 이미 있으면 갱신만 한다. */
function learnMerchant(keyword, cls) {
  var key = String(keyword || '').trim();
  if (!key) {
    return;
  }
  if (findRowById(SHEETS.MERCHANTS.name, key, 'keyword') >= 0) {
    bumpMerchant(key);
    return;
  }
  appendRow(SHEETS.MERCHANTS.name, {
    keyword: key,
    type: cls.type || 'expense',
    kind: cls.kind || 'variable',
    category: cls.category || '',
    envelope: cls.envelope || '',
    recurring_id: cls.recurring_id || '',
    hit_count: 1,
    last_used: nowIso()
  });
}

/** Recurring 정의를 id 로 찾는다. */
function recurringDefinition(recurringId) {
  var id = String(recurringId || '').trim();
  var found = null;
  readAllCached(SHEETS.RECURRING.name).forEach(function (r) {
    if (String(r.id).trim() === id) {
      found = r;
    }
  });
  return found;
}

/**
 * 파싱·분류 결과를 원장에 기록한다.
 * - recurring_id 가 가리키는 정의가 kind=fixed 면 그 달의 expected 행을 확정한다(confirmRecurring).
 * - kind=variable 정의(레슨 같은 건별 수입)면 보통 행처럼 추가하되 recurring_id 를 남긴다.
 * - 그 밖에는 새 행을 추가한다. 환불은 음수 금액의 지출 행이다.
 * 기록한 행은 사용자별 "마지막 기록" 으로 기억해 두어 "취소" 가 정확히 그 행을 되돌리게 한다.
 * @param {!Object} parsed Parser.parseMessage 결과
 * @param {?Object} cls 분류 결과(Merchants 행 또는 버튼 선택으로 만든 객체)
 * @param {{userId: (string|number), source: string}} meta
 * @return {!Object} { txId, mode, type, category, envelope, kind, expectedAmount, name, nth, debt }
 */
function recordTransaction(parsed, cls, meta) {
  var classification = cls || {};
  var recurringId = String(classification.recurring_id || '').trim();
  var definition = recurringId ? recurringDefinition(recurringId) : null;
  if (definition && String(definition.kind || 'fixed').trim() === 'fixed') {
    return confirmRecurring(definition, parsed, meta);
  }

  var txId = newId('tx');
  var now = nowIso();
  var type = definition ? recurringType(definition) : (classification.type || parsed.type || 'expense');
  var row = {
    id: txId,
    date: parsed.date,
    type: type,
    kind: definition ? 'variable' : (classification.kind || 'variable'),
    category: definition ? String(definition.category || '') : (classification.category || ''),
    envelope: type === 'expense' ? (classification.envelope || '') : '',
    merchant: parsed.merchantTextRaw || parsed.merchantText || '',
    amount: parsed.amount,
    currency: parsed.currency,
    amount_usd: parsed.amount_usd,
    recurring_id: definition ? String(definition.id).trim() : '',
    status: 'active',
    memo: parsed.refund ? squeezeMemo('환불', parsed.memo) : (parsed.memo || ''),
    payer: payerName(meta.userId),
    source: meta.source || 'telegram',
    created_at: now,
    updated_at: now,
    updated_by: String(meta.userId)
  };
  appendRow(SHEETS.TRANSACTIONS.name, row);
  rememberLastTx(meta.userId, { txId: txId, mode: 'append' });
  return {
    txId: txId,
    mode: parsed.refund ? 'refund' : 'append',
    type: row.type,
    kind: row.kind,
    category: row.category,
    envelope: row.envelope,
    expectedAmount: null,
    name: row.merchant,
    nth: 0,
    debt: null
  };
}

/** 메모 앞에 표시를 붙인다. */
function squeezeMemo(prefix, memo) {
  var m = String(memo || '').trim();
  return m ? prefix + ' · ' + m : prefix;
}

/**
 * 그 달의 해당 고정 항목 expected 행을 실제 금액으로 확정한다.
 * expected 행이 없으면(이미 확정됐거나 예약이 안 됐으면) confirmed 상태의 새 행을 추가한다.
 * 이미 confirmed 인 행은 절대 덮어쓰지 않는다. 두 번째 결제는 두 번째 행이다.
 * @param {!Object} definition Recurring 행
 * @param {!Object} parsed
 * @param {{userId: (string|number), source: string}} meta
 * @return {!Object}
 */
function confirmRecurring(definition, parsed, meta) {
  var recurringId = String(definition.id).trim();
  var month = String(parsed.date).slice(0, 7);
  var pick = pickConfirmTarget(monthTransactions(month), recurringId);
  var expectedAmount = Number(definition.expected_amount) || null;
  var name = String(definition.name || recurringId);
  var type = recurringType(definition);
  var txId;
  var mode;

  if (pick.target) {
    var target = pick.target;
    rememberLastTx(meta.userId, {
      txId: target.id,
      mode: 'confirm',
      previous: {
        amount: target.amount,
        currency: target.currency,
        amount_usd: target.amount_usd,
        date: toDateStr(target.date),
        status: String(target.status).trim()
      }
    });
    updateRowById(SHEETS.TRANSACTIONS.name, target.id, {
      amount: parsed.amount,
      currency: parsed.currency,
      amount_usd: parsed.amount_usd,
      date: parsed.date,
      status: 'confirmed',
      payer: payerName(meta.userId),
      updated_by: String(meta.userId)
    });
    txId = target.id;
    mode = 'confirm';
  } else {
    txId = newId('tx');
    var now = nowIso();
    appendRow(SHEETS.TRANSACTIONS.name, {
      id: txId,
      date: parsed.date,
      type: type,
      kind: 'fixed',
      category: String(definition.category || ''),
      envelope: '',
      merchant: name,
      amount: parsed.amount,
      currency: parsed.currency,
      amount_usd: parsed.amount_usd,
      recurring_id: recurringId,
      status: 'confirmed',
      memo: pick.confirmedCount > 0 ? '이번 달 ' + (pick.confirmedCount + 1) + '번째' : (parsed.memo || ''),
      payer: payerName(meta.userId),
      source: meta.source || 'telegram',
      created_at: now,
      updated_at: now,
      updated_by: String(meta.userId)
    });
    rememberLastTx(meta.userId, { txId: txId, mode: 'append' });
    mode = 'confirm';
  }

  var debt = null;
  if (type === 'expense') {
    debt = applyDebtPayment(recurringId, parsed.amount, parsed.currency);
  }

  return {
    txId: txId,
    mode: mode,
    type: type,
    kind: 'fixed',
    category: String(definition.category || ''),
    envelope: '',
    expectedAmount: expectedAmount,
    expectedCurrency: String(definition.currency || 'USD').trim().toUpperCase(),
    name: name,
    nth: pick.target ? 1 : pick.confirmedCount + 1,
    debt: debt
  };
}

/**
 * 고정비 확정이 부채 상환이면 연결된 Debts 행의 원금과 남은 회차를 줄인다.
 * Debts.recurring_id 가 이 고정비를 가리키는 행만 손댄다.
 * @param {string} recurringId
 * @param {number} amount 상환액
 * @param {string} currency 상환액 통화
 * @return {?{name: string, principal: number, interest: number, currency: string}}
 */
function applyDebtPayment(recurringId, amount, currency) {
  var id = String(recurringId || '').trim();
  var debt = null;
  readAllCached(SHEETS.DEBTS.name).forEach(function (row) {
    if (String(row.recurring_id || '').trim() === id) {
      debt = row;
    }
  });
  if (!debt || !(Number(amount) > 0)) {
    return null;
  }
  var debtCurrency = String(debt.currency || 'USD').trim().toUpperCase();
  var payCurrency = String(currency || 'USD').trim().toUpperCase();
  var fx = getConfigNumber('fx_usd_krw', 1332);
  var payment = Number(amount);
  if (debtCurrency !== payCurrency && fx > 0) {
    payment = debtCurrency === 'KRW' ? payment * fx : payment / fx;
  }
  var result = amortizeOnce(debt.principal, debt.rate_pct, payment);
  var remaining = Math.max((Number(debt.remaining_count) || 0) - 1, 0);
  updateRowById(SHEETS.DEBTS.name, debt.id, {
    principal: result.newPrincipal,
    remaining_count: remaining
  });
  return {
    name: String(debt.name || debt.id),
    principal: result.newPrincipal,
    interest: result.interest,
    currency: debtCurrency
  };
}

/**
 * 원장 행을 soft delete 한다.
 * @param {string} txId
 * @param {string|number} by
 * @return {boolean} 성공 여부
 */
function softDelete(txId, by) {
  var rowNum = updateRowById(SHEETS.TRANSACTIONS.name, txId, {
    status: 'deleted',
    updated_by: String(by)
  });
  return rowNum > 0;
}

/**
 * 사용자의 마지막 기록을 되돌린다.
 * 캐시의 메모(무엇을 어떻게 기록했는지)를 먼저 보고, 없으면 Log 탭에서 tx id 를 찾는다.
 * 추가한 행은 soft delete, 확정한 행은 expected 로 되돌린다(금액도 원래대로).
 * @param {string|number} userId
 * @return {?{row: !Object, action: string}} 되돌릴 것이 없으면 null
 */
function undoLast(userId) {
  var memo = recallLastTx(userId);
  var txId = memo && memo.txId ? memo.txId : lastRecordedTxFromLog(userId);
  if (!txId) {
    return null;
  }
  var row = null;
  readAllCached(SHEETS.TRANSACTIONS.name).forEach(function (r) {
    if (String(r.id).trim() === txId) {
      row = r;
    }
  });
  if (!row || String(row.status).trim() === 'deleted') {
    forgetLastTx(userId);
    return null;
  }
  var fallback = null;
  if (String(row.recurring_id || '').trim()) {
    var def = recurringDefinition(row.recurring_id);
    if (def) {
      var currency = String(def.currency || 'USD').trim().toUpperCase();
      var expected = recurringExpectedAmount(def, String(toDateStr(row.date)).slice(0, 7));
      fallback = {
        amount: expected,
        currency: currency,
        amount_usd: toUsd(expected, currency),
        status: initialRecurringStatus(def)
      };
    }
  }
  var plan = undoPlan(row, memo, fallback);
  var patch = {};
  Object.keys(plan.patch).forEach(function (k) { patch[k] = plan.patch[k]; });
  patch.updated_by = String(userId);
  updateRowById(SHEETS.TRANSACTIONS.name, row.id, patch);
  forgetLastTx(userId);
  return { row: row, action: plan.action };
}

/**
 * 세부예산 사이에서 이번 달 예산을 옮긴다. Budgets 행의 amount 만 바꾼다.
 * @param {string} month 'YYYY-MM'
 * @param {string} from
 * @param {string} to
 * @param {number} amountUsd
 * @return {{from: string, to: string, fromAmount: number, toAmount: number}}
 */
function moveBudget(month, from, to, amountUsd) {
  var envelopes = getConfigList('envelopes');
  if (envelopes.indexOf(from) < 0 || envelopes.indexOf(to) < 0) {
    throw new Error('세부예산 이름을 찾지 못했습니다: ' + from + ' → ' + to + ' (세부예산: ' + envelopes.join(', ') + ')');
  }
  if (from === to) {
    throw new Error('같은 세부예산입니다.');
  }
  var amount = Number(amountUsd) || 0;
  if (!(amount > 0)) {
    throw new Error('옮길 금액이 없습니다.');
  }
  var fromAmount = roundCents(getBudgetAmount(month, from) - amount);
  var toAmount = roundCents(getBudgetAmount(month, to) + amount);
  var patch = {};
  patch[from] = fromAmount;
  patch[to] = toAmount;
  applyBudgetAmounts(month, patch);
  invalidateReadCache(SHEETS.BUDGETS.name);
  return { from: from, to: to, fromAmount: fromAmount, toAmount: toAmount };
}
