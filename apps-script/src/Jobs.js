/**
 * Jobs.js — 시간 트리거로 도는 작업. 아침 요약, 월 시작, 월 마감.
 * 사람이 아무것도 하지 않아도 고정비가 잡히고 상태가 전달되게 한다.
 */

/** allowed_telegram_ids 전원에게 같은 메시지를 보낸다. */
function broadcast(text) {
  var ids = getConfigList('allowed_telegram_ids');
  ids.forEach(function (id) {
    sendMessage(id, text);
  });
  return ids.length;
}

/**
 * 아침 요약: 어제 유동비 지출, 봉투별 상태, 오늘 결제일인 고정비 안내.
 */
function dailySummary() {
  var today = todayStr();
  var yesterday = shiftDays(today, -1);
  var month = today.slice(0, 7);
  var transactions = monthTransactions(month);

  var yesterdayTotal = 0;
  transactions.forEach(function (row) {
    if (String(row.type).trim() !== 'expense' || String(row.kind).trim() !== 'variable') {
      return;
    }
    var status = String(row.status).trim();
    if (status !== 'active' && status !== 'confirmed') {
      return;
    }
    if (toDateStr(row.date) === yesterday) {
      yesterdayTotal += Number(row.amount_usd) || 0;
    }
  });

  var lines = ['📅 ' + today];
  lines.push('어제 유동비 ' + formatUsd(roundCents(yesterdayTotal)));
  getConfigList('envelopes').forEach(function (envelope) {
    lines.push(formatStatusLine(envelopeStatus({
      budget: getBudgetAmount(month, envelope),
      transactions: transactions,
      envelope: envelope,
      today: today
    }), envelope));
  });

  var day = Number(today.slice(8, 10));
  activeRecurring().forEach(function (definition) {
    if (Number(definition.due_day) !== day) {
      return;
    }
    var name = String(definition.name || definition.id);
    var amount = recurringExpectedAmount(definition, month);
    lines.push('오늘 ' + name + ' 예상 ' + formatUsd(toUsd(amount, definition.currency)) +
      " — 실제 금액 다르면 '" + name + ' ' + Math.round(amount) + "' 로 보내주세요");
  });

  var text = lines.join('\n');
  broadcast(text);
  return text;
}

/**
 * 월 시작: 예산 시드(전월 복사 + carry 이월) → 고정비 expected 생성 → 요약 전송.
 */
function monthlyOpen() {
  var month = currentMonthStr();
  var copied = openMonthBudgets(month);
  var seeded = seedBudgets(month);
  var posted = postMonthlyRecurring(month);
  recomputeIncomePct(month);

  var lines = ['🗓 ' + month + ' 시작'];
  lines.push('예산 ' + (copied + seeded) + '개 봉투 준비, 고정비 ' + posted + '건 예약');
  var transactions = monthTransactions(month);
  getConfigList('envelopes').forEach(function (envelope) {
    lines.push(formatStatusLine(envelopeStatus({
      budget: getBudgetAmount(month, envelope),
      transactions: transactions,
      envelope: envelope,
      today: todayStr()
    }), envelope));
  });

  var text = lines.join('\n');
  broadcast(text);
  return text;
}

/**
 * 이번 달 예산 행을 전월에서 복사한다.
 * carryover=carry 인 봉투는 전월 잔액을 이번 달 amount 에 더한다.
 * 이미 이번 달 행이 있으면 건너뛴다(멱등).
 * @param {string} month 'YYYY-MM'
 * @return {number} 새로 만든 행 수
 */
function openMonthBudgets(month) {
  var prevMonth = previousMonth(month);
  var budgets = readAll(SHEETS.BUDGETS.name);

  var existing = {};
  var previous = [];
  budgets.forEach(function (row) {
    var envelope = String(row.envelope).trim();
    if (String(row.month).trim() === month) {
      existing[envelope] = true;
    } else if (String(row.month).trim() === prevMonth) {
      previous.push(row);
    }
  });

  var prevTransactions = monthTransactions(prevMonth);
  var lastDayPrev = prevMonth + '-' + daysInMonth(prevMonth);
  var added = 0;

  previous.forEach(function (row) {
    var envelope = String(row.envelope).trim();
    if (!envelope || existing[envelope]) {
      return;
    }
    var carryover = String(row.carryover || 'reset').trim();
    var amount = Number(row.amount) || 0;
    if (carryover === 'carry') {
      var status = envelopeStatus({
        budget: amount,
        transactions: prevTransactions,
        envelope: envelope,
        today: lastDayPrev
      });
      amount = roundCents(amount + status.remaining);
    }
    appendRow(SHEETS.BUDGETS.name, {
      month: month,
      envelope: envelope,
      amount: amount,
      carryover: carryover
    });
    added++;
  });
  return added;
}

/** 'YYYY-MM' 의 직전 달. */
function previousMonth(month) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim());
  if (!m) {
    return month;
  }
  var year = Number(m[1]);
  var mon = Number(m[2]) - 1;
  if (mon < 1) {
    mon = 12;
    year -= 1;
  }
  return year + '-' + (mon < 10 ? '0' + mon : String(mon));
}

/**
 * 월 마감 보고. 말일에만 실제로 보낸다. 데이터는 바꾸지 않는다.
 * 트리거는 매일 21시에 돌고, 말일 여부는 이 함수가 판정한다.
 * @return {string} 보낸 메시지. 말일이 아니면 빈 문자열.
 */
function monthlyClose() {
  var today = todayStr();
  var month = today.slice(0, 7);
  if (Number(today.slice(8, 10)) !== daysInMonth(month)) {
    return ''; // 말일이 아니면 아무것도 하지 않는다
  }

  var transactions = monthTransactions(month);
  var lines = ['📊 ' + month + ' 마감'];

  getConfigList('envelopes').forEach(function (envelope) {
    var status = envelopeStatus({
      budget: getBudgetAmount(month, envelope),
      transactions: transactions,
      envelope: envelope,
      today: today
    });
    lines.push(envelope + ' 예산 ' + formatUsd(status.budget) +
      ' · 실행 ' + formatUsd(status.spentTotal) +
      ' · 잔액 ' + formatUsd(status.remaining));
  });

  var deviations = [];
  activeRecurring().forEach(function (definition) {
    var id = String(definition.id).trim();
    var tolerance = Number(definition.tolerance_pct) || 0;
    var expected = recurringExpectedAmount(definition, month);
    if (!expected) {
      return;
    }
    transactions.forEach(function (row) {
      if (String(row.recurring_id || '').trim() !== id) {
        return;
      }
      if (String(row.status).trim() !== 'confirmed') {
        return;
      }
      var actual = Number(row.amount) || 0;
      var diffPct = Math.abs(actual - expected) / expected * 100;
      if (diffPct > tolerance) {
        deviations.push('· ' + String(definition.name || id) + ' 예상 ' + expected +
          ' → 실제 ' + actual + ' (' + (actual >= expected ? '+' : '-') +
          roundCents(diffPct) + '%)');
      }
    });
  });
  if (deviations.length) {
    lines.push('');
    lines.push('고정비 편차 (허용치 초과)');
    lines = lines.concat(deviations);
  }

  var pending = unconfirmedRecurring(month);
  if (pending.length) {
    lines.push('');
    lines.push('미확인 고정비');
    pending.forEach(function (item) {
      lines.push('· ' + item.name + ' 예상 ' + formatUsd(item.amount_usd) + ' (' + item.date + ')');
    });
  }

  var text = lines.join('\n');
  broadcast(text);
  return text;
}

/**
 * 시간 트리거를 다시 설치한다. 기존 트리거를 모두 지우고 세 개를 등록한다(멱등).
 * - dailySummary: 매일 Config.daily_summary_hour 시
 * - monthlyOpen: 매월 Config.month_start_day 일 06시
 * - monthlyClose: 매일 21시 (말일 여부는 monthlyClose 가 판정)
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  var summaryHour = getConfigNumber('daily_summary_hour', 7);
  var startDay = getConfigNumber('month_start_day', 1);

  ScriptApp.newTrigger('dailySummary').timeBased().everyDays(1).atHour(summaryHour).create();
  ScriptApp.newTrigger('monthlyOpen').timeBased().onMonthDay(startDay).atHour(6).create();
  ScriptApp.newTrigger('monthlyClose').timeBased().everyDays(1).atHour(21).create();

  var msg = '트리거 3개 설치: dailySummary ' + summaryHour + '시, monthlyOpen ' +
    startDay + '일 06시, monthlyClose 매일 21시(말일에만 동작)';
  Logger.log(msg);
  return msg;
}
