/**
 * LedgerRules.js — 순수 모듈. 원장에 쓰기 전에 내리는 결정들을 모아 둔다.
 * Google 서비스에 의존하지 않는다. 봇(Ledger.js)과 웹앱이 같은 규칙을 쓴다.
 *
 * GAS 는 파일을 한 전역 스코프에 이어 붙이므로 내부 헬퍼에는 rules 접두사를 쓴다.
 */

/** 비교용 정규화. Classifier.normalize 와 같은 규칙이지만 모듈 간 의존을 피하려고 따로 둔다. */
function rulesNormalize(s) {
  return String(s === null || s === undefined ? '' : s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function rulesRound(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** 'YYYY-MM-DD' → 에포크 기준 일수. 형식이 아니면 null. 시간대 영향을 받지 않게 UTC 로만 센다. */
function rulesDayNumber(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) {
    return null;
  }
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

/** 에포크 기준 일수 → 'YYYY-MM-DD'. */
function rulesFromDayNumber(n) {
  var d = new Date(n * 86400000);
  var mm = d.getUTCMonth() + 1;
  var dd = d.getUTCDate();
  return d.getUTCFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);
}

/**
 * amount_rule 문자열을 해석한다.
 *   'fixed'                              — expected_amount 를 그대로 쓴다
 *   'income_pct:N'                       — 그 달 수입 합의 N%
 *   'biweekly:<1회 금액>@<기준 급여일>'   — 2주급. 그 달 급여일 수 × 1회 금액
 * 알 수 없는 값은 fixed 로 본다.
 * @param {string} rule
 * @return {{type: string, pct: (number|undefined), perCheck: (number|undefined), anchor: (string|undefined)}}
 */
function parseAmountRule(rule) {
  var s = String(rule === null || rule === undefined ? '' : rule).trim();
  var pct = /^income_pct:(\d+(?:\.\d+)?)$/.exec(s);
  if (pct) {
    return { type: 'income_pct', pct: Number(pct[1]) };
  }
  var bi = /^biweekly:(\d+(?:\.\d+)?)@(\d{4}-\d{2}-\d{2})$/.exec(s);
  if (bi && rulesDayNumber(bi[2]) !== null) {
    return { type: 'biweekly', perCheck: Number(bi[1]), anchor: bi[2] };
  }
  return { type: 'fixed' };
}

/**
 * 그 달에 들어오는 2주급 급여일 목록(오름차순).
 * 기준 급여일에서 14일 간격으로 앞뒤 어느 쪽으로든 센다. 기준일이 미래여도 된다.
 * 1년 26회이므로 대부분의 달은 2개, 두 달은 3개가 나온다.
 * @param {string} month 'YYYY-MM'
 * @param {string} anchor 실제로 받은(또는 받을) 급여일 하나 'YYYY-MM-DD'
 * @return {!Array<string>}
 */
function biweeklyPaydays(month, anchor) {
  var a = rulesDayNumber(anchor);
  var m = /^(\d{4})-(\d{2})$/.exec(String(month || '').trim());
  if (a === null || !m) {
    return [];
  }
  var year = Number(m[1]);
  var mon = Number(m[2]);
  var first = Math.round(Date.UTC(year, mon - 1, 1) / 86400000);
  var last = Math.round(Date.UTC(year, mon, 0) / 86400000);
  var out = [];
  for (var d = a + Math.ceil((first - a) / 14) * 14; d <= last; d += 14) {
    out.push(rulesFromDayNumber(d));
  }
  return out;
}

/**
 * 정의와 월로 예상 금액을 구한다(정의 통화 기준). 봇과 웹앱이 같은 값을 내게 하는 곳이다.
 * income_pct 는 그 달 수입 합이 필요하므로 호출자가 monthIncome 으로 넘긴다.
 * 계산할 수 없으면 expected_amount 로 물러난다.
 * @param {!Object} definition Recurring 행
 * @param {string} month 'YYYY-MM'
 * @param {number} monthIncome 그 달 수입 합(정의 통화가 아니라 USD 기준)
 * @return {number}
 */
function expectedAmountFor(definition, month, monthIncome) {
  var fallback = Number(definition.expected_amount) || 0;
  var rule = parseAmountRule(definition.amount_rule);
  if (rule.type === 'income_pct') {
    var computed = rulesRound((Number(monthIncome) || 0) * rule.pct / 100);
    return computed > 0 ? computed : fallback;
  }
  if (rule.type === 'biweekly') {
    var count = biweeklyPaydays(month, rule.anchor).length;
    return count > 0 ? rulesRound(rule.perCheck * count) : fallback;
  }
  return fallback;
}

/**
 * 고정 항목을 확정할 때 어느 행을 손댈지 정한다.
 * 그 달의 expected 행만 확정 대상이다. 이미 confirmed 인 행은 절대 덮어쓰지 않는다.
 * 그런 행이 있으면 "이번 달 N번째 결제" 로 새 행을 추가해야 한다.
 * @param {!Array<!Object>} monthRows 그 달 원장 행
 * @param {string} recurringId
 * @return {{target: ?Object, confirmedCount: number}}
 */
function pickConfirmTarget(monthRows, recurringId) {
  var id = String(recurringId || '').trim();
  var target = null;
  var confirmedCount = 0;
  (monthRows || []).forEach(function (row) {
    if (String(row.recurring_id || '').trim() !== id) {
      return;
    }
    var status = String(row.status).trim();
    if (status === 'expected' && !target) {
      target = row;
    } else if (status === 'confirmed') {
      confirmedCount++;
    }
  });
  return { target: target, confirmedCount: confirmedCount };
}

/**
 * 텍스트에 active=Y, kind=fixed 인 Recurring 항목 이름이 들어 있으면 그 정의를 돌려준다.
 * 이름이 긴 것을 먼저 본다. "한국 대출 상환" 이 "대출" 보다 먼저 잡히게.
 * kind=variable 정의는 계획값일 뿐이라 여기서 잡지 않는다(레슨처럼 건별로 기록된다).
 * @param {string} text
 * @param {!Array<!Object>} definitions Recurring 행
 * @return {?Object}
 */
function matchRecurringName(text, definitions) {
  var target = rulesNormalize(text);
  if (!target) {
    return null;
  }
  var best = null;
  var bestLen = -1;
  (definitions || []).forEach(function (def) {
    if (String(def.active).trim().toUpperCase() !== 'Y') {
      return;
    }
    if (String(def.kind || 'fixed').trim() !== 'fixed') {
      return;
    }
    var key = rulesNormalize(def.name);
    if (!key || target.indexOf(key) < 0) {
      return;
    }
    if (key.length > bestLen) {
      best = def;
      bestLen = key.length;
    }
  });
  return best;
}

/**
 * 마지막 기록을 되돌리는 방법을 정한다.
 * - 새로 추가한 행(append): soft delete.
 * - expected 행을 확정한 것(confirm): expected 로 되돌리고 금액도 원래대로.
 *   원래 금액을 모르면(캐시 만료) Recurring 예상 금액으로 되돌린다.
 * @param {!Object} row 현재 원장 행
 * @param {?Object} memo 기록 당시 남긴 {mode, previous: {amount, currency, amount_usd, date}}
 * @param {?{amount: number, currency: string, amount_usd: number}} fallbackExpected
 * @return {{action: string, patch: !Object}}
 */
function undoPlan(row, memo, fallbackExpected) {
  var status = String(row.status || '').trim();
  var mode = memo && memo.mode ? memo.mode : (status === 'confirmed' && String(row.source) === 'recurring' ? 'confirm' : 'append');
  if (mode === 'confirm') {
    var prev = (memo && memo.previous) || fallbackExpected || {};
    var patch = { status: 'expected', payer: '' };
    if (prev.amount !== undefined) {
      patch.amount = prev.amount;
    }
    if (prev.currency !== undefined) {
      patch.currency = prev.currency;
    }
    if (prev.amount_usd !== undefined) {
      patch.amount_usd = prev.amount_usd;
    }
    if (prev.date !== undefined) {
      patch.date = prev.date;
    }
    return { action: 'revert', patch: patch };
  }
  return { action: 'delete', patch: { status: 'deleted' } };
}

/**
 * 다음 달 봉투 예산을 정한다.
 * - carry 봉투: 남은 금액이 양수면 더한다. 음수는 더하지 않는다.
 * - reset 봉투: 이번 달 금액 그대로.
 * - 모든 봉투의 초과분(음수 잔액) 합은 overspendEnvelope 의 다음 달 금액에서 뺀다.
 *   식료품 예산을 생활 가능선 아래로 깎지 않으면서, 초과가 공짜가 되지도 않게 한다.
 * @param {!Array<{envelope: string, amount: number, carryover: string}>} prevBudgets 전월 Budgets 행
 * @param {!Object<string, {remaining: number}>} statusByEnvelope 전월 말일 기준 envelopeStatus
 * @param {string} overspendEnvelope 초과분을 흡수할 봉투 이름(없으면 흡수하지 않는다)
 * @return {!Array<{envelope: string, amount: number, carryover: string, note: string}>}
 */
function nextMonthBudgets(prevBudgets, statusByEnvelope, overspendEnvelope) {
  var absorb = String(overspendEnvelope || '').trim();
  var deficit = 0;
  var out = [];
  (prevBudgets || []).forEach(function (row) {
    var envelope = String(row.envelope || '').trim();
    if (!envelope) {
      return;
    }
    var carryover = String(row.carryover || 'reset').trim() === 'carry' ? 'carry' : 'reset';
    var amount = Number(row.amount) || 0;
    var remaining = statusByEnvelope && statusByEnvelope[envelope]
      ? Number(statusByEnvelope[envelope].remaining) || 0
      : 0;
    var note = '';
    if (remaining < 0 && envelope !== absorb) {
      deficit += -remaining;
      note = '초과 ' + rulesRound(-remaining) + ' → ' + (absorb || '(흡수 봉투 없음)');
    }
    if (carryover === 'carry' && remaining > 0) {
      amount = rulesRound(amount + remaining);
      note = '이월 +' + rulesRound(remaining);
    }
    out.push({ envelope: envelope, amount: amount, carryover: carryover, note: note });
  });
  if (absorb && deficit > 0) {
    out.forEach(function (row) {
      if (row.envelope === absorb) {
        row.amount = rulesRound(row.amount - deficit);
        row.note = (row.note ? row.note + ' · ' : '') + '초과분 흡수 -' + rulesRound(deficit);
      }
    });
  }
  return out;
}

/**
 * 한 번 상환했을 때 부채가 어떻게 줄어드는지 계산한다(월 복리 단순 상각).
 * @param {number} principal 남은 원금
 * @param {number} ratePct 연이율 %
 * @param {number} payment 이번 상환액(원금과 같은 통화)
 * @return {{interest: number, principalPaid: number, newPrincipal: number}}
 */
function amortizeOnce(principal, ratePct, payment) {
  var p = Number(principal) || 0;
  var r = (Number(ratePct) || 0) / 100 / 12;
  var pay = Number(payment) || 0;
  var interest = rulesRound(p * r);
  var principalPaid = rulesRound(Math.min(p, Math.max(pay - interest, 0)));
  return {
    interest: interest,
    principalPaid: principalPaid,
    newPrincipal: rulesRound(Math.max(p - principalPaid, 0))
  };
}

/**
 * 지금 상환액을 유지하면 몇 달 뒤에 끝나는지. 이자를 반영한다.
 * 상환액이 이자보다 작으면 영원히 안 끝나므로 null.
 * @param {number} principal
 * @param {number} ratePct
 * @param {number} payment
 * @return {?number}
 */
function payoffMonths(principal, ratePct, payment) {
  var p = Number(principal) || 0;
  var pay = Number(payment) || 0;
  if (p <= 0) {
    return 0;
  }
  if (pay <= 0) {
    return null;
  }
  var r = (Number(ratePct) || 0) / 100 / 12;
  if (r === 0) {
    return Math.ceil(p / pay);
  }
  if (pay <= p * r) {
    return null;
  }
  return Math.ceil(-Math.log(1 - (r * p) / pay) / Math.log(1 + r));
}

/**
 * 월 마감 점수 세 개. 저축률, 예산 안에 든 봉투 수, 고정비 편차 건수.
 * @param {{income: number, expense: number}} totals
 * @param {!Array<!Object>} envelopeStatuses
 * @param {number} deviationCount
 * @return {{savingRate: ?number, withinBudget: number, envelopes: number, deviations: number}}
 */
function monthScore(totals, envelopeStatuses, deviationCount) {
  var income = Number(totals && totals.income) || 0;
  var expense = Number(totals && totals.expense) || 0;
  var statuses = envelopeStatuses || [];
  var within = statuses.filter(function (s) { return Number(s.remaining) >= 0; }).length;
  return {
    savingRate: income > 0 ? Math.round(((income - expense) / income) * 100) : null,
    withinBudget: within,
    envelopes: statuses.length,
    deviations: Number(deviationCount) || 0
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseAmountRule: parseAmountRule,
    biweeklyPaydays: biweeklyPaydays,
    expectedAmountFor: expectedAmountFor,
    pickConfirmTarget: pickConfirmTarget,
    matchRecurringName: matchRecurringName,
    undoPlan: undoPlan,
    nextMonthBudgets: nextMonthBudgets,
    amortizeOnce: amortizeOnce,
    payoffMonths: payoffMonths,
    monthScore: monthScore
  };
}
