/**
 * Recurring.js — 고정 항목 자동 기장. 매월 Recurring 정의대로 expected 행을 만들어 둔다.
 * 봇으로 실제 금액이 들어오면 Ledger.confirmRecurring 이 그 행을 confirmed 로 바꾼다.
 * type 이 income 이면 수입원, transfer 면 저축(먼저 저축) 항목이다.
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

/** 그 달 수입 합계(USD). 실제로 들어온 income 행만 센다(예약 행은 제외). */
function monthIncomeTotal(month) {
  var total = 0;
  monthTransactions(month).forEach(function (row) {
    var status = String(row.status).trim();
    if (String(row.type).trim() !== 'income') {
      return;
    }
    if (!isSettledStatus(status)) {
      return;
    }
    total += Number(row.amount_usd) || 0;
  });
  return roundCents(total);
}

/**
 * 정의와 월로 예상 금액을 구한다(정의 통화 기준). 규칙 해석은 LedgerRules 가 한다.
 *   income_pct:N — 그 달 수입 합의 N% (아직 수입이 없으면 expected_amount)
 *   biweekly:M@YYYY-MM-DD — 2주급. 그 달 급여일 수 × M. 3번 받는 달은 저절로 1.5배가 된다
 * @return {number}
 */
function recurringExpectedAmount(definition, month) {
  return expectedAmountFor(definition, month, monthIncomeTotal(month));
}

/**
 * 그 달 예정 행을 어느 날짜에 만들지 정한다.
 * 2주급은 그 달 첫 급여일, 나머지는 due_day 다.
 * @param {!Object} definition
 * @param {string} month
 * @return {string} 'YYYY-MM-DD'
 */
function recurringDateForDefinition(definition, month) {
  var rule = parseAmountRule(definition.amount_rule);
  if (rule.type === 'biweekly') {
    var days = biweeklyPaydays(month, rule.anchor);
    if (days.length) {
      return days[0];
    }
  }
  return recurringDateFor(month, definition.due_day);
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
  return readAllCached(SHEETS.RECURRING.name).filter(function (row) {
    return String(row.active).trim().toUpperCase() === 'Y';
  });
}

/** Recurring 정의의 유형. type 열이 비어 있으면 expense 다(이전 시트와 호환). */
function recurringType(definition) {
  var t = String(definition.type || '').trim().toLowerCase();
  if (t === 'income' || t === 'transfer') {
    return t;
  }
  return 'expense';
}

/** active=Y, kind=fixed, type=expense 인 고정비의 월 예상 합계(USD). 비상금 목표의 기준이다. */
function fixedMonthlyExpenseUsd(month) {
  var total = 0;
  activeRecurring().forEach(function (definition) {
    if (recurringType(definition) !== 'expense') {
      return;
    }
    if (String(definition.kind || 'fixed').trim() !== 'fixed') {
      return;
    }
    total += toUsd(recurringExpectedAmount(definition, month), definition.currency);
  });
  return roundCents(total);
}

/**
 * 그 달의 저축(type=transfer) 계획과 실행.
 * @param {string} month
 * @return {{expected: number, actual: number, items: !Array<{name: string, expected: number, actual: number}>}}
 */
function savingsPlan(month) {
  var rows = monthTransactions(month);
  var items = [];
  var expected = 0;
  var actual = 0;
  activeRecurring().forEach(function (definition) {
    if (recurringType(definition) !== 'transfer') {
      return;
    }
    var id = String(definition.id).trim();
    var plan = toUsd(recurringExpectedAmount(definition, month), definition.currency);
    var done = 0;
    rows.forEach(function (row) {
      var status = String(row.status).trim();
      if (String(row.recurring_id || '').trim() === id && isSettledStatus(status)) {
        done += Number(row.amount_usd) || 0;
      }
    });
    expected += plan;
    actual += done;
    items.push({ name: String(definition.name || id), expected: plan, actual: roundCents(done) });
  });
  return { expected: roundCents(expected), actual: roundCents(actual), items: items };
}

/**
 * 그 달 고정 지출 목록을 실행 로그에 표로 찍는다.
 *
 * 금액이 정해진 것과 고지서를 봐야 아는 것을 나눠 보여 준다. 앞의 것은 달이 열릴 때
 * 이미 예산에서 빠져 있고, 뒤의 것은 실제 금액을 보낼 때 빠진다.
 * 수입은 빼고, 유동비(식료품 등)도 고정 항목이 아니므로 여기에 없다.
 *
 * @param {string=} yyyyMm 생략하면 이번 달
 * @return {string} 찍은 내용 그대로
 */
function listFixedExpenses(yyyyMm) {
  var month = yyyyMm || currentMonthStr();
  var rows = monthTransactions(month);
  var groups = { fixed: [], variable: [], transfer: [] };

  activeRecurring().forEach(function (definition) {
    var type = recurringType(definition);
    if (type === 'income') {
      return; // 지출 목록이다. 수입은 웹앱 수입 화면에서 본다
    }
    var id = String(definition.id).trim();
    var currency = String(definition.currency || 'USD').trim().toUpperCase() || 'USD';
    var plan = toUsd(recurringExpectedAmount(definition, month), currency);

    var actual = 0;
    var reserved = '';
    var settled = false;
    rows.forEach(function (row) {
      if (String(row.recurring_id || '').trim() !== id) {
        return;
      }
      var status = String(row.status).trim();
      if (isSettledStatus(status)) {
        actual += Number(row.amount_usd) || 0;
        settled = true;
      } else if (isReservedStatus(status) && !reserved) {
        reserved = status === 'committed' ? '선반영' : '예정';
      }
    });

    var bucket = type === 'transfer' ? 'transfer' : recurringCertainty(definition);
    groups[bucket].push({
      name: String(definition.name || id),
      category: String(definition.category || ''),
      dueDay: Number(definition.due_day) || 1,
      plan: plan,
      actual: roundCents(actual),
      state: settled ? '집행' : (reserved || '기장 없음')
    });
  });

  var order = function (a, b) { return a.dueDay - b.dueDay || a.name.localeCompare(b.name); };
  Object.keys(groups).forEach(function (k) { groups[k].sort(order); });

  var lines = ['── ' + month + ' 고정 지출 ──'];
  var totalPlan = 0;
  var totalActual = 0;

  var section = function (title, items, note) {
    if (!items.length) {
      return;
    }
    lines.push('');
    lines.push('[' + title + ']');
    if (note) {
      lines.push('  ' + note);
    }
    var sumPlan = 0;
    var sumActual = 0;
    items.forEach(function (it) {
      sumPlan += it.plan;
      sumActual += it.actual;
      lines.push('  ' + it.dueDay + '일 · ' + it.name +
        (it.category ? ' (' + it.category + ')' : '') +
        ' · 예상 ' + formatUsd(it.plan) +
        ' · ' + it.state +
        (it.state === '집행' ? ' ' + formatUsd(it.actual) : ''));
    });
    lines.push('  소계 예상 ' + formatUsd(sumPlan) + ' · 집행 ' + formatUsd(sumActual));
    totalPlan += sumPlan;
    totalActual += sumActual;
  };

  section('금액 확정 · 달이 열릴 때 예산에서 이미 뺌', groups.fixed);
  section('금액 변동 · 실제 금액을 보내야 예산에 반영', groups.variable,
    '예상액은 참고용이다. 아직 예산에서 빠지지 않았다.');
  section('저축 (수입도 지출도 아님)', groups.transfer);

  lines.push('');
  lines.push('합계 · 예상 ' + formatUsd(totalPlan) + ' · 집행 ' + formatUsd(totalActual));
  lines.push('유동비(식료품·생필품 등)와 수입은 이 목록에 없다.');
  lines.push('────────────');

  var out = lines.join('\n');
  Logger.log(out);
  return out;
}

/**
 * 그 달의 고정 항목 expected 행을 만든다. 멱등: 이미 있으면 건너뛴다.
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
    if (id && (isReservedStatus(status) || status === 'confirmed')) {
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
      date: recurringDateForDefinition(definition, month),
      type: recurringType(definition),
      kind: 'fixed',
      category: String(definition.category || ''),
      envelope: '',
      merchant: String(definition.name || id),
      amount: amount,
      currency: currency,
      amount_usd: toUsd(amount, currency),
      recurring_id: id,
      status: initialRecurringStatus(definition),
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
 * 이미 만들어진 예약 행의 상태를 지금 기준으로 다시 맞춘다.
 *
 * Recurring.certainty 를 바꿨거나, 이 기능이 생기기 전에 만들어진 달을 손볼 때 쓴다.
 * 확정된(confirmed) 행과 실제 기록(active)은 건드리지 않는다.
 * @param {string=} yyyyMm 생략하면 이번 달
 * @return {{toCommitted: number, toExpected: number}}
 */
function resyncReservedStatuses(yyyyMm) {
  var month = yyyyMm || currentMonthStr();
  var defs = {};
  readAllCached(SHEETS.RECURRING.name).forEach(function (row) {
    defs[String(row.id).trim()] = row;
  });

  var toCommitted = 0;
  var toExpected = 0;
  monthTransactions(month).forEach(function (row) {
    var id = String(row.recurring_id || '').trim();
    var current = String(row.status).trim();
    if (!id || !defs[id] || !isReservedStatus(current)) {
      return;
    }
    var wanted = initialRecurringStatus(defs[id]);
    if (wanted === current) {
      return;
    }
    updateRowById(SHEETS.TRANSACTIONS.name, row.id, { status: wanted, updated_by: 'system' });
    if (wanted === 'committed') {
      toCommitted++;
    } else {
      toExpected++;
    }
  });
  Logger.log(month + ' 예약 행 보정: 선반영 ' + toCommitted + '건, 예정 ' + toExpected + '건');
  return { toCommitted: toCommitted, toExpected: toExpected };
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
    // 2주급은 수입 기록과 무관하게 달력으로 정해지므로 다시 계산할 일이 없다.
    if (parseAmountRule(definition.amount_rule).type !== 'income_pct') {
      return;
    }
    var id = String(definition.id).trim();
    var amount = recurringExpectedAmount(definition, month);
    var currency = String(definition.currency || 'USD').trim().toUpperCase() || 'USD';
    rows.forEach(function (row) {
      if (String(row.recurring_id || '').trim() !== id) {
        return;
      }
      if (!isReservedStatus(row.status)) {
        return; // 확정된 금액은 덮어쓰지 않는다
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
 * 아직 확정되지 않은(status=expected) 고정 항목 목록.
 * @param {string=} yyyyMm
 * @return {!Array<{id: string, name: string, amount_usd: number, date: string, type: string}>}
 */
function unconfirmedRecurring(yyyyMm) {
  var month = yyyyMm || currentMonthStr();
  var names = {};
  readAllCached(SHEETS.RECURRING.name).forEach(function (row) {
    names[String(row.id).trim()] = String(row.name || row.id);
  });
  return monthTransactions(month)
    .filter(function (row) {
      return String(row.recurring_id || '').trim() !== '' &&
        isReservedStatus(row.status);
    })
    .map(function (row) {
      var id = String(row.recurring_id).trim();
      return {
        id: id,
        name: names[id] || id,
        amount_usd: Number(row.amount_usd) || 0,
        date: toDateStr(row.date),
        type: String(row.type || 'expense')
      };
    });
}
