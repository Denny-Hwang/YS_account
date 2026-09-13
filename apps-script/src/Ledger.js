/**
 * Ledger.js — 원장 쓰기와 조회. Webhook.js 는 시트를 직접 만지지 않고 이 함수들만 호출한다.
 * 원장은 append-only + soft delete 다. 행을 물리 삭제하지 않는다(Golden Rule 3).
 */

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

/** Telegram user id 를 사람 이름으로 바꾼다. Config 의 `name_<id>` 키를 본다. */
function payerName(userId) {
  var name = getConfig('name_' + String(userId), '');
  return name || String(userId);
}

/** 해당 월·봉투의 예산 금액. 없으면 0. */
function getBudgetAmount(month, envelope) {
  var rows = readAll(SHEETS.BUDGETS.name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].month).trim() === month &&
        String(rows[i].envelope).trim() === String(envelope).trim()) {
      return Number(rows[i].amount) || 0;
    }
  }
  return 0;
}

/** 해당 월의 원장 행 전체(날짜는 YYYY-MM-DD 문자열로 정규화). */
function monthTransactions(month) {
  return readAll(SHEETS.TRANSACTIONS.name)
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

/**
 * 파싱·분류 결과를 원장에 기록한다.
 * recurring_id 가 있으면 그 달의 expected 행을 확정하고, 없으면 새 행을 추가한다.
 * @param {!Object} parsed Parser.parseMessage 결과
 * @param {?Object} cls 분류 결과(Merchants 행 또는 버튼 선택으로 만든 객체)
 * @param {{userId: (string|number), source: string}} meta
 * @return {!Object} { txId, mode, category, envelope, kind, expectedAmount, name }
 */
function recordTransaction(parsed, cls, meta) {
  var classification = cls || {};
  var recurringId = String(classification.recurring_id || '').trim();
  if (recurringId) {
    return confirmRecurring(recurringId, parsed, meta);
  }

  var txId = newId('tx');
  var now = nowIso();
  var row = {
    id: txId,
    date: parsed.date,
    type: classification.type || parsed.type || 'expense',
    kind: classification.kind || 'variable',
    category: classification.category || '',
    envelope: classification.envelope || '',
    merchant: parsed.merchantTextRaw || parsed.merchantText || '',
    amount: parsed.amount,
    currency: parsed.currency,
    amount_usd: parsed.amount_usd,
    recurring_id: '',
    status: 'active',
    memo: parsed.memo || '',
    payer: payerName(meta.userId),
    source: meta.source || 'telegram',
    created_at: now,
    updated_at: now,
    updated_by: String(meta.userId)
  };
  appendRow(SHEETS.TRANSACTIONS.name, row);
  return {
    txId: txId,
    mode: 'append',
    type: row.type,
    kind: row.kind,
    category: row.category,
    envelope: row.envelope,
    expectedAmount: null,
    name: row.merchant
  };
}

/**
 * 그 달의 해당 고정비 expected 행을 실제 금액으로 확정한다.
 * 행이 없으면 confirmed 상태로 새로 추가한다.
 * @param {string} recurringId
 * @param {!Object} parsed
 * @param {{userId: (string|number), source: string}} meta
 * @return {!Object}
 */
function confirmRecurring(recurringId, parsed, meta) {
  var month = String(parsed.date).slice(0, 7);
  var definition = null;
  readAll(SHEETS.RECURRING.name).forEach(function (r) {
    if (String(r.id).trim() === recurringId) {
      definition = r;
    }
  });

  var target = null;
  monthTransactions(month).forEach(function (row) {
    var status = String(row.status).trim();
    if (String(row.recurring_id).trim() === recurringId &&
        (status === 'expected' || status === 'confirmed')) {
      target = row;
    }
  });

  var expectedAmount = definition ? Number(definition.expected_amount) || null : null;
  var name = definition ? String(definition.name) : recurringId;

  if (target) {
    updateRowById(SHEETS.TRANSACTIONS.name, target.id, {
      amount: parsed.amount,
      currency: parsed.currency,
      amount_usd: parsed.amount_usd,
      date: parsed.date,
      status: 'confirmed',
      payer: payerName(meta.userId),
      updated_by: String(meta.userId)
    });
    return {
      txId: target.id,
      mode: 'confirm',
      type: definition ? recurringType(definition) : 'expense',
      kind: 'fixed',
      category: String(target.category || (definition ? definition.category : '')),
      envelope: String(target.envelope || ''),
      expectedAmount: expectedAmount,
      name: name
    };
  }

  var txId = newId('tx');
  var now = nowIso();
  appendRow(SHEETS.TRANSACTIONS.name, {
    id: txId,
    date: parsed.date,
    type: definition ? recurringType(definition) : 'expense',
    kind: 'fixed',
    category: definition ? String(definition.category || '') : '',
    envelope: '',
    merchant: name,
    amount: parsed.amount,
    currency: parsed.currency,
    amount_usd: parsed.amount_usd,
    recurring_id: recurringId,
    status: 'confirmed',
    memo: parsed.memo || '',
    payer: payerName(meta.userId),
    source: meta.source || 'telegram',
    created_at: now,
    updated_at: now,
    updated_by: String(meta.userId)
  });
  return {
    txId: txId,
    mode: 'confirm',
    type: definition ? recurringType(definition) : 'expense',
    kind: 'fixed',
    category: definition ? String(definition.category || '') : '',
    envelope: '',
    expectedAmount: expectedAmount,
    name: name
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
 * 해당 사용자가 오늘 만든 마지막 active 행을 찾는다.
 * @param {string|number} userId
 * @param {string} date 'YYYY-MM-DD'
 * @return {?Object}
 */
function lastActiveByUser(userId, date) {
  var rows = readAll(SHEETS.TRANSACTIONS.name);
  var uid = String(userId);
  for (var i = rows.length - 1; i >= 0; i--) {
    var row = rows[i];
    if (String(row.updated_by).trim() !== uid) {
      continue;
    }
    if (String(row.status).trim() !== 'active') {
      continue;
    }
    var createdDay = String(row.created_at).slice(0, 10);
    if (toDateStr(row.date) === date || createdDay === date) {
      return row;
    }
  }
  return null;
}
