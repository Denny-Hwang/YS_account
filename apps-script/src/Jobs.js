/**
 * Jobs.js — 시간 트리거로 도는 작업. 아침 요약, 주간 결산, 월 시작, 월 마감.
 * 사람이 아무것도 하지 않아도 고정비가 잡히고 상태가 전달되게 한다.
 * 아침 요약은 예외 기반이다. 전부 초록이면 한 줄, 아니면 문제 있는 봉투만 길게 쓴다.
 */

/** 이 파일이 설치하는 트리거 핸들러. installTriggers 는 이 이름들만 지우고 다시 만든다. */
var JOB_HANDLERS = ['dailySummary', 'weeklyDigest', 'monthlyOpen', 'monthlyClose'];

/** "이 달은 열렸다" 표시를 캐시에 두는 시간(초). 6시간. */
var MONTH_OPEN_FLAG_TTL_SECONDS = 21600;

/** allowed_telegram_ids 전원에게 같은 메시지를 보낸다. */
function broadcast(text) {
  var ids = getConfigList('allowed_telegram_ids');
  ids.forEach(function (id) {
    sendMessage(id, text);
  });
  return ids.length;
}

/** 봉투별 envelopeStatus 목록. */
function envelopeStatuses(month, transactions, today) {
  return getConfigList('envelopes').map(function (envelope) {
    return {
      envelope: envelope,
      status: envelopeStatus({
        budget: getBudgetAmount(month, envelope),
        transactions: transactions,
        envelope: envelope,
        today: today
      })
    };
  });
}

/**
 * 그 달의 수입·지출 합(USD). transfer 는 어느 쪽도 아니다.
 * 지출은 금액이 확정된 고정비(committed)까지 센다. 미리 빼 둬야 여유가 있어 보이지 않는다.
 * 수입은 실제로 들어온 것만 센다. 들어올 예정인 돈을 더하면 반대 방향의 착시가 생긴다.
 */
function monthTotals(month) {
  var income = 0;
  var expense = 0;
  monthTransactions(month).forEach(function (row) {
    var status = String(row.status).trim();
    var type = String(row.type).trim();
    if (type === 'income') {
      if (isSettledStatus(status)) {
        income += Number(row.amount_usd) || 0;
      }
      return;
    }
    if (!isSpentStatus(status)) {
      return;
    }
    if (type === 'expense') {
      expense += Number(row.amount_usd) || 0;
    }
  });
  return { income: roundCents(income), expense: roundCents(expense) };
}

/**
 * 이 달이 열려 있는지 확인하고, 안 열렸으면 연다(예산 행 + 고정 항목 예약).
 * 월 시작 트리거가 빠져도 첫 기록이나 아침 요약 때 여기서 보정된다. 멱등이다.
 * @param {string=} yyyyMm
 * @return {boolean} 이번 호출에서 실제로 열었으면 true
 */
function ensureMonthOpened(yyyyMm) {
  var month = yyyyMm || currentMonthStr();
  var cache = CacheService.getScriptCache();
  var flag = 'month_open_' + month;
  if (cache.get(flag)) {
    return false;
  }
  var hasBudget = readAllCached(SHEETS.BUDGETS.name).some(function (row) {
    return String(row.month).trim() === month;
  });
  var opened = false;
  if (!hasBudget) {
    openMonthBudgets(month);
    seedBudgets(month);
    invalidateReadCache(SHEETS.BUDGETS.name);
    opened = true;
  }
  if (postMonthlyRecurring(month) > 0) {
    opened = true;
  }
  cache.put(flag, '1', MONTH_OPEN_FLAG_TTL_SECONDS);
  return opened;
}

/**
 * 아침 요약. 예외 기반: 전부 초록이면 한 줄, 아니면 문제 있는 봉투만 길게.
 * 오늘 결제일인 고정 항목과 지나간 미확정 항목은 항상 알린다.
 */
function dailySummary() {
  var today = todayStr();
  var yesterday = shiftDays(today, -1);
  var month = today.slice(0, 7);
  ensureMonthOpened(month);
  var transactions = monthTransactions(month);

  var yesterdayTotal = 0;
  transactions.forEach(function (row) {
    if (String(row.type).trim() !== 'expense' || String(row.kind).trim() !== 'variable') {
      return;
    }
    var status = String(row.status).trim();
    if (!isSpentStatus(status)) {
      return;
    }
    if (toDateStr(row.date) === yesterday) {
      yesterdayTotal += Number(row.amount_usd) || 0;
    }
  });

  var statuses = envelopeStatuses(month, transactions, today);
  var lines = ['📅 ' + today + ' · 어제 유동비 ' + formatUsd(roundCents(yesterdayTotal))];
  var allGreen = statuses.length > 0 && statuses.every(function (s) { return s.status.signal === 'green'; });
  if (allGreen) {
    var leftTotal = statuses.reduce(function (a, s) { return a + s.status.allowanceLeftToday; }, 0);
    lines.push('🟢 전 봉투 계획 안 · 오늘 ' + formatUsd(roundCents(leftTotal)) +
      ' (남은 ' + remainingDaysInclToday(today) + '일)');
  } else {
    statuses.forEach(function (s) {
      lines.push(s.status.signal === 'green'
        ? formatStatusShort(s.status, s.envelope)
        : formatStatusLine(s.status, s.envelope));
    });
  }

  var savings = savingsPlan(month);
  if (savings.expected > 0) {
    lines.push('💰 저축 ' + formatUsd(savings.actual) + ' / ' + formatUsd(savings.expected));
  }

  var day = Number(today.slice(8, 10));
  activeRecurring().forEach(function (definition) {
    if (String(definition.kind || 'fixed').trim() !== 'fixed') {
      return;
    }
    // 2주급은 due_day 가 아니라 그 달 급여일 중 오늘이 있는지로 판정한다.
    var rule = parseAmountRule(definition.amount_rule);
    var perOccurrence;
    if (rule.type === 'biweekly') {
      if (biweeklyPaydays(month, rule.anchor).indexOf(today) < 0) {
        return;
      }
      perOccurrence = rule.perCheck;
    } else {
      if (Number(definition.due_day) !== day) {
        return;
      }
      perOccurrence = recurringExpectedAmount(definition, month);
    }
    var name = String(definition.name || definition.id);
    var type = recurringType(definition);
    var verb = type === 'income' ? '들어오면' : (type === 'transfer' ? '옮겼으면' : '실제 금액 다르면');
    lines.push('오늘 ' + name + ' 예정 ' + formatUsd(toUsd(perOccurrence, definition.currency)) +
      " — " + verb + " '" + name + ' ' + Math.round(perOccurrence) + "' 로 보내주세요");
  });

  var overdue = unconfirmedRecurring(month).filter(function (item) { return item.date < today; });
  if (overdue.length) {
    lines.push('⏳ 미확정 ' + overdue.length + '건: ' + overdue.map(function (i) { return i.name; }).join(', '));
  }

  var text = lines.join('\n');
  broadcast(text);
  return text;
}

/**
 * 주간 결산. 매일 돌지만 Config.weekly_digest_day(0=일요일 … 6=토요일)에만 보낸다.
 * 이번 주(오늘 포함 7일) 유동비를 지난주와 비교하고, 남은 기간의 하루치를 알려 준다.
 * @return {string} 보낸 메시지. 해당 요일이 아니면 빈 문자열.
 */
function weeklyDigest() {
  var today = todayStr();
  var tz = getConfig('timezone', 'America/Los_Angeles');
  var dow = Number(Utilities.formatDate(new Date(), tz, 'u')) % 7; // 일요일 0
  if (dow !== getConfigNumber('weekly_digest_day', 0)) {
    return '';
  }
  var month = today.slice(0, 7);
  var weekStart = shiftDays(today, -6);
  var prevStart = shiftDays(today, -13);
  var prevEnd = shiftDays(today, -7);

  var thisWeek = 0;
  var lastWeek = 0;
  var months = {};
  months[month] = true;
  months[prevStart.slice(0, 7)] = true;
  Object.keys(months).forEach(function (m) {
    monthTransactions(m).forEach(function (row) {
      if (String(row.type).trim() !== 'expense' || String(row.kind).trim() !== 'variable') {
        return;
      }
      var status = String(row.status).trim();
      if (!isSpentStatus(status)) {
        return;
      }
      var d = toDateStr(row.date);
      var v = Number(row.amount_usd) || 0;
      if (d >= weekStart && d <= today) {
        thisWeek += v;
      } else if (d >= prevStart && d <= prevEnd) {
        lastWeek += v;
      }
    });
  });

  var statuses = envelopeStatuses(month, monthTransactions(month), today);
  var deltaTotal = statuses.reduce(function (a, s) { return a + s.status.deltaVsPlan; }, 0);
  var allowanceTotal = statuses.reduce(function (a, s) { return a + s.status.allowanceToday; }, 0);
  var diff = roundCents(thisWeek - lastWeek);

  var lines = ['📈 주간 결산 ' + weekStart.slice(5).replace('-', '/') + '~' + today.slice(5).replace('-', '/')];
  lines.push('유동비 ' + formatUsd(roundCents(thisWeek)) + ' (지난주 ' + formatUsd(roundCents(lastWeek)) +
    ', ' + formatSigned(diff) + ')');
  statuses.forEach(function (s) {
    lines.push(signalGlyph(s.status.signal) + ' ' + s.envelope + ' 잔액 ' + formatUsd(s.status.remaining) +
      ' · 계획 대비 ' + formatSigned(s.status.deltaVsPlan));
  });
  lines.push('남은 ' + remainingDaysInclToday(today) + '일 · 하루 ' + formatUsd(roundCents(allowanceTotal)) +
    ' · 이달 계획 대비 ' + formatSigned(roundCents(deltaTotal)));
  var savings = savingsPlan(month);
  if (savings.expected > 0) {
    lines.push('💰 저축 ' + formatUsd(savings.actual) + ' / ' + formatUsd(savings.expected));
  }

  var text = lines.join('\n');
  broadcast(text);
  return text;
}

/**
 * 월 시작: 예산 시드(전월 복사 + carry 이월 + 초과분 흡수) → 고정 항목 expected 생성 → 요약 전송.
 */
function monthlyOpen() {
  var month = currentMonthStr();
  var opened = openMonthBudgets(month);
  var seeded = seedBudgets(month);
  invalidateReadCache(SHEETS.BUDGETS.name);
  var posted = postMonthlyRecurring(month);
  recomputeIncomePct(month);
  CacheService.getScriptCache().put('month_open_' + month, '1', MONTH_OPEN_FLAG_TTL_SECONDS);

  var lines = ['🗓 ' + month + ' 시작'];
  lines.push('예산 ' + (opened.added + seeded) + '개 봉투 준비, 고정 항목 ' + posted + '건 예약');
  opened.notes.forEach(function (note) {
    lines.push('· ' + note);
  });
  var transactions = monthTransactions(month);
  envelopeStatuses(month, transactions, todayStr()).forEach(function (s) {
    lines.push(formatStatusShort(s.status, s.envelope) + ' · 예산 ' + formatUsd(s.status.budget));
  });

  var text = lines.join('\n');
  broadcast(text);
  return text;
}

/**
 * 이번 달 예산 행을 전월에서 만든다. 규칙은 LedgerRules.nextMonthBudgets 에 있다.
 * - carry 봉투는 전월 양수 잔액을 더한다(싱킹 펀드).
 * - 전월 초과분은 Config.overspend_envelope 의 이번 달 금액에서 뺀다.
 * 이미 이번 달 행이 있는 봉투는 건너뛴다(멱등).
 * @param {string} month 'YYYY-MM'
 * @return {{added: number, notes: !Array<string>}}
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
  if (!previous.length) {
    return { added: 0, notes: [] };
  }

  var prevTransactions = monthTransactions(prevMonth);
  var lastDayPrev = prevMonth + '-' + daysInMonth(prevMonth);
  var statusByEnvelope = {};
  previous.forEach(function (row) {
    var envelope = String(row.envelope).trim();
    statusByEnvelope[envelope] = envelopeStatus({
      budget: Number(row.amount) || 0,
      transactions: prevTransactions,
      envelope: envelope,
      today: lastDayPrev
    });
  });

  var next = nextMonthBudgets(previous, statusByEnvelope, getConfig('overspend_envelope', ''));
  var added = 0;
  var notes = [];
  next.forEach(function (row) {
    if (existing[row.envelope]) {
      return;
    }
    appendRow(SHEETS.BUDGETS.name, {
      month: month,
      envelope: row.envelope,
      amount: row.amount,
      carryover: row.carryover
    });
    added++;
    if (row.note) {
      notes.push(row.envelope + ' ' + row.note);
    }
  });
  return { added: added, notes: notes };
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
 * 점수 세 개(저축률, 예산 안 봉투 수, 고정비 편차 건수)를 지난달과 나란히 보여 준다.
 * @return {string} 보낸 메시지. 말일이 아니면 빈 문자열.
 */
function monthlyClose() {
  var today = todayStr();
  var month = today.slice(0, 7);
  if (Number(today.slice(8, 10)) !== daysInMonth(month)) {
    return ''; // 말일이 아니면 아무것도 하지 않는다
  }
  return buildMonthlyCloseReport(month, today, true);
}

/**
 * 월 마감 보고문을 만든다. send=false 면 보내지 않고 문자열만 돌려준다(테스트·수동 확인용).
 * @param {string} month
 * @param {string} asOf 기준일
 * @param {boolean} send
 * @return {string}
 */
function buildMonthlyCloseReport(month, asOf, send) {
  var transactions = monthTransactions(month);
  var lines = ['📊 ' + month + ' 마감'];

  var statuses = envelopeStatuses(month, transactions, asOf);
  statuses.forEach(function (s) {
    lines.push(signalGlyph(s.status.signal) + ' ' + s.envelope + ' 예산 ' + formatUsd(s.status.budget) +
      ' · 실행 ' + formatUsd(s.status.spentTotal) +
      ' · 잔액 ' + formatUsd(s.status.remaining));
  });

  var deviations = [];
  activeRecurring().forEach(function (definition) {
    var id = String(definition.id).trim();
    var tolerance = Number(definition.tolerance_pct) || 0;
    var expectedUsd = toUsd(recurringExpectedAmount(definition, month), definition.currency);
    if (!expectedUsd) {
      return;
    }
    var actualUsd = 0;
    var seen = false;
    transactions.forEach(function (row) {
      if (String(row.recurring_id || '').trim() !== id) {
        return;
      }
      if (String(row.status).trim() !== 'confirmed') {
        return;
      }
      seen = true;
      actualUsd += Number(row.amount_usd) || 0;
    });
    if (!seen) {
      return;
    }
    var diffPct = Math.abs(actualUsd - expectedUsd) / expectedUsd * 100;
    if (diffPct > tolerance) {
      deviations.push('· ' + String(definition.name || id) + ' 예상 ' + formatUsd(expectedUsd) +
        ' → 실제 ' + formatUsd(actualUsd) + ' (' + (actualUsd >= expectedUsd ? '+' : '-') +
        roundCents(diffPct) + '%)');
    }
  });

  var prevMonth = previousMonth(month);
  var score = monthScore(monthTotals(month), statuses.map(function (s) { return s.status; }), deviations.length);
  var prevScore = monthScore(
    monthTotals(prevMonth),
    envelopeStatuses(prevMonth, monthTransactions(prevMonth), prevMonth + '-' + daysInMonth(prevMonth))
      .map(function (s) { return s.status; }),
    0
  );
  lines.push('');
  lines.push('점수 · 저축률 ' + (score.savingRate === null ? '-' : score.savingRate + '%') +
    ' (지난달 ' + (prevScore.savingRate === null ? '-' : prevScore.savingRate + '%') + ')' +
    ' · 예산 안 ' + score.withinBudget + '/' + score.envelopes + ' 봉투' +
    ' (지난달 ' + prevScore.withinBudget + '/' + prevScore.envelopes + ')' +
    ' · 고정비 편차 ' + score.deviations + '건');

  var savings = savingsPlan(month);
  if (savings.expected > 0) {
    lines.push('💰 저축 ' + formatUsd(savings.actual) + ' / ' + formatUsd(savings.expected) +
      (savings.actual >= savings.expected ? ' 달성' : ' 미달'));
  }

  if (deviations.length) {
    lines.push('');
    lines.push('고정비 편차 (허용치 초과)');
    lines = lines.concat(deviations);
  }

  var pending = unconfirmedRecurring(month);
  if (pending.length) {
    lines.push('');
    lines.push('미확인 고정 항목');
    pending.forEach(function (item) {
      lines.push('· ' + item.name + ' 예상 ' + formatUsd(item.amount_usd) + ' (' + item.date + ')');
    });
  }

  var text = lines.join('\n');
  if (send) {
    broadcast(text);
  }
  return text;
}

/**
 * 시간 트리거를 다시 설치한다. 이 파일의 핸들러(JOB_HANDLERS)만 지우고 네 개를 등록한다(멱등).
 * 사용자가 따로 만든 트리거는 건드리지 않는다.
 * - dailySummary: 매일 Config.daily_summary_hour 시
 * - weeklyDigest: 매일 19시 (요일은 weeklyDigest 가 판정)
 * - monthlyOpen: 매월 1일 06시
 * - monthlyClose: 매일 21시 (말일 여부는 monthlyClose 가 판정)
 */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (JOB_HANDLERS.indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  var summaryHour = getConfigNumber('daily_summary_hour', 7);

  ScriptApp.newTrigger('dailySummary').timeBased().everyDays(1).atHour(summaryHour).create();
  ScriptApp.newTrigger('weeklyDigest').timeBased().everyDays(1).atHour(19).create();
  ScriptApp.newTrigger('monthlyOpen').timeBased().onMonthDay(1).atHour(6).create();
  ScriptApp.newTrigger('monthlyClose').timeBased().everyDays(1).atHour(21).create();

  var msg = '트리거 4개 설치: dailySummary ' + summaryHour + '시, weeklyDigest 매일 19시(요일은 Config), ' +
    'monthlyOpen 1일 06시, monthlyClose 매일 21시(말일에만 동작)';
  Logger.log(msg);
  return msg;
}
