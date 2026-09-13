/**
 * Recurring.js — 고정비 자동 기장. 매월 Recurring 정의대로 expected 행을 만들어 둔다.
 * 봇으로 실제 금액이 들어오면 Ledger.confirmRecurring 이 그 행을 confirmed 로 바꾼다.
 */

/** 'YYYY-MM' 과 일자로 날짜 문자열을 만든다. 말일을 넘으면 말일로 맞춘다. */
function recurringDateFor(month, dueDay) {
  var total = daysInMonth(month);
  var day = Number(dueDay) || 1;
  if (day < 1) {
    day = 1;
  }
  if (total && day > total) {
    day = total;
  }
  return month + '-' + (day < 10 ? '0' + day : String(day));
}

/** 그 달 수입 합계(USD). status 가 active 또는 confirmed 인 income 행만 센다. */
function monthIncomeTotal(month) {
  var total = 0;
  monthTransactions(month).forEach(function (row) {
    var status = String(row.status).trim();
    if (String(row.type).trim() !== 'income') {
      return;
    }
    if (status !== 'active' && status !== 'confirmed') {
      return;
    }
    total += Number(row.amount_usd) || 0;
  });
  return roundCents(total);
}

/**
 * 정의와 월로 예상 금액을 구한다.
 * amount_rule 이 income_pct:N 이면 그 달 수입 합의 N% 를 쓴다(수입이 아직 없으면 0).
 * @return {number}
 */
function recurringExpectedAmount(definition, month) {
  var rule = String(definition.amount_rule || 'fixed').trim();
  var pct = /^income_pct:(\d+(?:\.\d+)?)$/.exec(rule);
  if (pct) {
    var computed = roundCents(monthIncomeTotal(month) * Number(pct[1]) / 100);
    if (computed > 0) {
      return computed;
    }
    // 그 달 수입이 아직 기록되지 않았으면 expected_amount 를 예산 값으로 쓴다.
    return Number(definition.expected_amount) || 0;
  }
  return Number(definition.expected_amount) || 0;
}

/** 통화에 맞춰 USD 환산액을 구한다. */
function toUsd(amount, currency) {
  if (String(currency).trim().toUpperCase() === 'KRW') {
    var fx = getConfigNumber('fx_usd_krw', 1332);
    return fx > 0 ? roundCents(Number(amount) / fx) : 0;
  }
  return roundCents(Number(amount));
}

/** active=Y 인 Recurring 정의 목록. */
function activeRecurring() {
  return readAll(SHEETS.RECURRING.name).filter(function (row) {
    return String(row.active).trim().toUpperCase() === 'Y';
  });
}

/** Recurring 정의의 유형. type 열이 비어 있으면 expense 다(이전 시트와 호환). */
function recurringType(definition) {
  var t = String(definition.type || '').trim().toLowerCase();
  return t === 'income' ? 'income' : 'expense';
}

/**
 * 그 달의 고정비 expected 행을 만든다. 멱등: 이미 있으면 건너뛴다.
 * @param {string=} yyyyMm 생략하면 이번 달
 * @return {number} 새로 추가한 행 수
 */
function postMonthlyRecurring(yyyyMm) {
  var month = yyyyMm || currentMonthStr();

  // 멱등성의 핵심: 그 달에 status 가 expected 또는 confirmed 인 행이 이미 있으면 건너뛴다.
  var posted = {};
  monthTransactions(month).forEach(function (row) {
    var id = String(row.recurring_id || '').trim();
    var status = String(row.status).trim();
    if (id && (status === 'expected' || status === 'confirmed')) {
      posted[id] = true;
    }
  });

  var added = 0;
  activeRecurring().forEach(function (definition) {
    var id = String(definition.id).trim();
    if (!id || posted[id]) {
      return; // 이미 있으면 건너뜀
    }
    if (String(definition.kind || 'fixed').trim() !== 'fixed') {
      return; // variable 은 예상치일 뿐이다. 레슨처럼 건별로 기록되므로 예약 행을 만들지 않는다
    }
    var currency = String(definition.currency || 'USD').trim().toUpperCase() || 'USD';
    var amount = recurringExpectedAmount(definition, month);
    var now = nowIso();
    appendRow(SHEETS.TRANSACTIONS.name, {
      id: newId('tx'),
      date: recurringDateFor(month, definition.due_day),
      type: recurringType(definition),
      kind: 'fixed',
      category: String(definition.category || ''),
      envelope: '',
      merchant: String(definition.name || id),
      amount: amount,
      currency: currency,
      amount_usd: toUsd(amount, currency),
      recurring_id: id,
      status: 'expected',
      memo: '',
      payer: '',
      source: 'recurring',
      created_at: now,
      updated_at: now,
      updated_by: 'system'
    });
    added++;
  });
  return added;
}

/**
 * income_pct 규칙 항목을 그 달 수입 합으로 다시 계산한다.
 * 아직 status 가 expected 인 행만 손댄다(확정된 금액은 덮어쓰지 않는다).
 * @param {string=} yyyyMm
 * @return {number} 갱신한 행 수
 */
function recomputeIncomePct(yyyyMm) {
  var month = yyyyMm || currentMonthStr();
  var rows = monthTransactions(month);
  var updated = 0;

  activeRecurring().forEach(function (definition) {
    if (!/^income_pct:/.test(String(definition.amount_rule || '').trim())) {
      return;
    }
    var id = String(definition.id).trim();
    var amount = recurringExpectedAmount(definition, month);
    var currency = String(definition.currency || 'USD').trim().toUpperCase() || 'USD';
    rows.forEach(function (row) {
      if (String(row.recurring_id || '').trim() !== id) {
        return;
      }
      if (String(row.status).trim() !== 'expected') {
        return;
      }
      updateRowById(SHEETS.TRANSACTIONS.name, row.id, {
        amount: amount,
        currency: currency,
        amount_usd: toUsd(amount, currency),
        updated_by: 'system'
      });
      updated++;
    });
  });
  return updated;
}

/**
 * 아직 확정되지 않은(status=expected) 고정비 목록.
 * @param {string=} yyyyMm
 * @return {!Array<{id: string, name: string, amount_usd: number, date: string}>}
 */
function unconfirmedRecurring(yyyyMm) {
  var month = yyyyMm || currentMonthStr();
  var names = {};
  readAll(SHEETS.RECURRING.name).forEach(function (row) {
    names[String(row.id).trim()] = String(row.name || row.id);
  });
  return monthTransactions(month)
    .filter(function (row) {
      return String(row.recurring_id || '').trim() !== '' &&
        String(row.status).trim() === 'expected';
    })
    .map(function (row) {
      var id = String(row.recurring_id).trim();
      return {
        id: id,
        name: names[id] || id,
        amount_usd: Number(row.amount_usd) || 0,
        date: toDateStr(row.date)
      };
    });
}
