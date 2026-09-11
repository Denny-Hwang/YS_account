/**
 * Budget.js — 순수 모듈. 봉투별 예산 소진 상태와 롤링 일일 가용액을 계산한다.
 * Google 서비스에 의존하지 않는다.
 */

/** 유동비 지출로 세는 원장 상태. */
var SPENT_STATUSES = ['active', 'confirmed'];

/** 소수 둘째 자리 반올림. Parser.js 와 중복 정의를 피하기 위해 이름을 달리한다. */
function roundCents(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * 해당 월의 일수.
 * @param {string} yyyyMm 'YYYY-MM'
 * @return {number}
 */
function daysInMonth(yyyyMm) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm || '').trim());
  if (!m) {
    return 0;
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

/**
 * 오늘을 포함해 그 달 말일까지 남은 일수.
 * @param {string} today 'YYYY-MM-DD'
 * @return {number}
 */
function remainingDaysInclToday(today) {
  var s = String(today || '').trim();
  var total = daysInMonth(s.slice(0, 7));
  if (!total) {
    return 0;
  }
  var day = Number(s.slice(8, 10));
  if (!day || day > total) {
    return 0;
  }
  return total - day + 1;
}

/** 원장 행이 해당 봉투의 유동비 지출인지 판정한다. */
function isVariableExpense(tx, envelope, month) {
  if (!tx) {
    return false;
  }
  if (String(tx.type).trim() !== 'expense') {
    return false;
  }
  if (String(tx.kind).trim() !== 'variable') {
    return false;
  }
  if (SPENT_STATUSES.indexOf(String(tx.status).trim()) < 0) {
    return false;
  }
  if (String(tx.envelope).trim() !== String(envelope).trim()) {
    return false;
  }
  return String(tx.date).trim().slice(0, 7) === month;
}

/**
 * 봉투 하나의 예산 소진 상태를 계산한다.
 * spentTotal 은 그 달의 모든 해당 지출 합이다(오늘 이후 날짜로 미리 적은 행 포함).
 * spentBeforeToday 와 spentToday 는 그 부분집합이다.
 * @param {{budget: number, transactions: !Array<!Object>, envelope: string, today: string}} input
 * @return {!Object}
 */
function envelopeStatus(input) {
  var budget = Number(input.budget) || 0;
  var today = String(input.today || '').trim();
  var month = today.slice(0, 7);
  var envelope = input.envelope;
  var rows = input.transactions || [];

  var spentBeforeToday = 0;
  var spentToday = 0;
  var spentTotal = 0;

  for (var i = 0; i < rows.length; i++) {
    var tx = rows[i];
    if (!isVariableExpense(tx, envelope, month)) {
      continue;
    }
    var amount = Number(tx.amount_usd) || 0;
    var date = String(tx.date).trim().slice(0, 10);
    spentTotal += amount;
    if (date < today) {
      spentBeforeToday += amount;
    } else if (date === today) {
      spentToday += amount;
    }
  }

  var remainingDays = remainingDaysInclToday(today);
  var total = daysInMonth(month);
  var dayOfMonth = Number(today.slice(8, 10)) || 0;
  var plannedPaceToDate = total > 0 ? budget * (dayOfMonth / total) : 0;

  spentBeforeToday = roundCents(spentBeforeToday);
  spentToday = roundCents(spentToday);
  spentTotal = roundCents(spentTotal);

  return {
    budget: roundCents(budget),
    spentBeforeToday: spentBeforeToday,
    spentToday: spentToday,
    spentTotal: spentTotal,
    remaining: roundCents(budget - spentTotal),
    remainingDays: remainingDays,
    allowanceToday: remainingDays > 0
      ? roundCents((budget - spentBeforeToday) / remainingDays)
      : 0,
    plannedPaceToDate: roundCents(plannedPaceToDate),
    deltaVsPlan: roundCents(plannedPaceToDate - spentTotal)
  };
}

/** 금액을 천 단위 콤마와 소수 두 자리로 표기한다. 음수는 -$12.34 형태. */
function formatUsd(n) {
  var value = Number(n) || 0;
  var sign = value < 0 ? '-' : '';
  var abs = Math.abs(value).toFixed(2);
  var parts = abs.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + '$' + parts.join('.');
}

/**
 * 봇 회신용 한 줄 문자열.
 * 예: "식료품 잔액 $771.30 · 남은 20일 × $38.57/일 · 계획 대비 +$135.20"
 * @param {!Object} status envelopeStatus 결과
 * @param {string} envelopeName
 * @return {string}
 */
function formatStatusLine(status, envelopeName) {
  var delta = Number(status.deltaVsPlan) || 0;
  var deltaText = (delta >= 0 ? '+' : '-') + formatUsd(Math.abs(delta));
  return envelopeName +
    ' 잔액 ' + formatUsd(status.remaining) +
    ' · 남은 ' + status.remainingDays + '일 × ' + formatUsd(status.allowanceToday) + '/일' +
    ' · 계획 대비 ' + deltaText;
}

if (typeof module !== 'undefined') {
  module.exports = {
    daysInMonth: daysInMonth,
    remainingDaysInclToday: remainingDaysInclToday,
    envelopeStatus: envelopeStatus,
    formatStatusLine: formatStatusLine,
    formatUsd: formatUsd,
    roundCents: roundCents,
    isVariableExpense: isVariableExpense
  };
}
