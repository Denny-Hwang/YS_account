/**
 * Budget.js — 순수 모듈. 봉투별 예산 소진 상태와 롤링 일일 가용액을 계산한다.
 * Google 서비스에 의존하지 않는다.
 */

/**
 * 예산에서 이미 빠진 것으로 세는 원장 상태.
 *   active    — 실제 집행된 유동비
 *   confirmed — 실제 집행된 고정 항목
 *   committed — 금액이 확정돼 있어 미리 빼 두는 고정 항목(렌트·구독료 등). 결제는 아직이다
 * expected 는 금액을 모르는 예약이라 세지 않는다.
 */
var SPENT_STATUSES = ['active', 'confirmed', 'committed'];

/** 원장 상태가 예산에 반영되는지 본다. */
function isSpentStatus(status) {
  return SPENT_STATUSES.indexOf(String(status === null || status === undefined ? '' : status).trim()) >= 0;
}

/** 실제 집행이 끝난 상태인가. committed 는 예산에는 들어가지만 아직 집행 전이다. */
function isSettledStatus(status) {
  var s = String(status === null || status === undefined ? '' : status).trim();
  return s === 'active' || s === 'confirmed';
}

/** 신호등 기준. 계획 대비 차이가 예산의 이 비율보다 나쁘면 빨강이다. */
var SIGNAL_RED_RATIO = 0.10;

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

/** 원장 행이 해당 봉투의 유동비 지출인지 판정한다. 환불(음수 금액)도 같은 봉투의 지출로 센다. */
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
  if (!isSpentStatus(tx.status)) {
    return false;
  }
  if (String(tx.envelope).trim() !== String(envelope).trim()) {
    return false;
  }
  return String(tx.date).trim().slice(0, 7) === month;
}

/**
 * 계획 대비 차이를 신호등 한 글자로 바꾼다.
 * 초록: 계획 안. 노랑: 계획보다 앞서 썼지만 예산의 10% 이내. 빨강: 그 이상이거나 봉투 초과.
 * @param {!Object} status envelopeStatus 결과
 * @return {string} 'green' | 'yellow' | 'red'
 */
function signalOf(status) {
  var budget = Number(status.budget) || 0;
  var delta = Number(status.deltaVsPlan) || 0;
  var remaining = Number(status.remaining) || 0;
  if (budget > 0 && remaining < 0) {
    return 'red';
  }
  if (delta >= 0) {
    return 'green';
  }
  if (budget > 0 && -delta <= budget * SIGNAL_RED_RATIO) {
    return 'yellow';
  }
  return 'red';
}

/** 신호등 이모지. */
function signalGlyph(signal) {
  return signal === 'red' ? '🔴' : signal === 'yellow' ? '🟡' : '🟢';
}

/**
 * 봉투 하나의 예산 소진 상태를 계산한다.
 * spentTotal 은 그 달의 모든 해당 지출 합이다(오늘 이후 날짜로 미리 적은 행 포함).
 * spentBeforeToday 와 spentToday 는 그 부분집합이다.
 *
 * allowanceToday 는 "오늘 아침 기준 하루치" 이고, allowanceLeftToday 는 거기서 오늘 쓴 만큼 뺀
 * "지금 남은 오늘치" 다. 사람에게 먼저 보여 줄 숫자는 allowanceLeftToday 다.
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

  var allowanceToday = remainingDays > 0
    ? roundCents((budget - spentBeforeToday) / remainingDays)
    : 0;

  var status = {
    budget: roundCents(budget),
    spentBeforeToday: spentBeforeToday,
    spentToday: spentToday,
    spentTotal: spentTotal,
    remaining: roundCents(budget - spentTotal),
    remainingDays: remainingDays,
    allowanceToday: allowanceToday,
    allowanceLeftToday: roundCents(allowanceToday - spentToday),
    plannedPaceToDate: roundCents(plannedPaceToDate),
    deltaVsPlan: roundCents(plannedPaceToDate - spentTotal)
  };
  status.signal = signalOf(status);
  return status;
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

/** 부호를 앞에 붙인 금액. +$12.34 / -$12.34 */
function formatSigned(n) {
  var value = Number(n) || 0;
  return (value >= 0 ? '+' : '-') + formatUsd(Math.abs(value));
}

/**
 * 봇 회신용 한 줄 문자열. "지금" 숫자를 앞에 둔다.
 * 예: "🟢 식료품 오늘 남은 $18.33 · 하루치 $38.33 · 잔액 $771.30 · 계획 대비 +$135.20"
 * @param {!Object} status envelopeStatus 결과
 * @param {string} envelopeName
 * @return {string}
 */
function formatStatusLine(status, envelopeName) {
  var signal = status.signal || signalOf(status);
  return signalGlyph(signal) + ' ' + envelopeName +
    ' 오늘 남은 ' + formatUsd(status.allowanceLeftToday) +
    ' · 하루치 ' + formatUsd(status.allowanceToday) +
    ' · 잔액 ' + formatUsd(status.remaining) +
    ' · 계획 대비 ' + formatSigned(status.deltaVsPlan);
}

/** 정상(초록)일 때 쓰는 짧은 한 줄. 아침 요약이 예외 기반으로 줄어들 때 쓴다. */
function formatStatusShort(status, envelopeName) {
  return signalGlyph(status.signal || signalOf(status)) + ' ' + envelopeName +
    ' 오늘 ' + formatUsd(status.allowanceLeftToday);
}

if (typeof module !== 'undefined') {
  module.exports = {
    daysInMonth: daysInMonth,
    isSpentStatus: isSpentStatus,
    isSettledStatus: isSettledStatus,
    remainingDaysInclToday: remainingDaysInclToday,
    envelopeStatus: envelopeStatus,
    formatStatusLine: formatStatusLine,
    formatStatusShort: formatStatusShort,
    formatUsd: formatUsd,
    formatSigned: formatSigned,
    roundCents: roundCents,
    isVariableExpense: isVariableExpense,
    signalOf: signalOf,
    signalGlyph: signalGlyph
  };
}
