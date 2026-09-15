/**
 * Parser.js — 순수 모듈. Telegram 메시지에서 의도·금액·통화·날짜·가맹점을 규칙 기반으로 추출한다.
 * Google 서비스에 의존하지 않는다(ADR-0002). LLM 을 쓰지 않는다.
 */

/** 수입 힌트 토큰 기본값. ctx.incomeHints 로 바꿀 수 있다(Config.income_hints). */
var INCOME_HINTS = ['수입', '급여', '입금'];

/** 환불 힌트 토큰. 하나라도 있으면 같은 세부예산의 음수 지출로 기록한다. */
var REFUND_HINTS = ['환불', '반품'];

/** 금액 토큰. 천 단위 콤마 형태를 먼저 시도하고, 없으면 소수점(.,) 형태를 본다. */
var NUM_RE = /(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;

/** 숫자 바로 뒤에 붙는 통화/배수 단위. 공백 한 칸까지는 허용한다. */
var UNIT_RE = /^[ ]?(만원|만|천원|원|won|krw|₩|불|달러|dollars?|usd)/i;

/** 숫자 뒤에 바로 붙은 미지원 영문 단위(12.5k 등)는 허용하지 않는다. */
var BAD_UNIT_RE = /^[A-Za-z]/;

/** 단위별 배수와 통화. */
var UNIT_SPEC = {
  '만원': { mul: 10000, currency: 'KRW' },
  '만': { mul: 10000, currency: 'KRW' },
  '천원': { mul: 1000, currency: 'KRW' },
  '원': { mul: 1, currency: 'KRW' },
  'won': { mul: 1, currency: 'KRW' },
  'krw': { mul: 1, currency: 'KRW' },
  '₩': { mul: 1, currency: 'KRW' },
  '불': { mul: 1, currency: 'USD' },
  '달러': { mul: 1, currency: 'USD' },
  'dollar': { mul: 1, currency: 'USD' },
  'dollars': { mul: 1, currency: 'USD' },
  'usd': { mul: 1, currency: 'USD' }
};

/** 소수 둘째 자리 반올림. */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 'YYYY-MM-DD' → {y,m,d}. 형식이 아니면 null. */
function parseYmd(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) {
    return null;
  }
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** 기준일에서 delta 일 이동한 날짜 문자열. */
function shiftDays(ymd, delta) {
  var p = parseYmd(ymd);
  if (!p) {
    return ymd;
  }
  var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + delta));
  return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
}

/** 연·월·일이 실제 존재하는 날짜인지 확인한다. */
function isValidYmd(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * 텍스트에서 날짜 토큰을 하나 뽑고 제거한다.
 * 슬래시 날짜(9/8)는 어디에 있어도 되지만, 대시 날짜(09-08)는 메시지 맨 앞에서만 인정한다.
 * "7-11 5.50" 같은 가맹점 이름이 날짜로 읽히는 것을 막기 위해서다.
 * @return {{date: string, rest: string, low: boolean}}
 */
function extractDate(text, today) {
  var rest = text;
  var date = today;
  var low = false;
  var found = null;

  var full = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(rest);
  if (full && isValidYmd(Number(full[1]), Number(full[2]), Number(full[3]))) {
    found = full[0];
    date = full[1] + '-' + pad2(Number(full[2])) + '-' + pad2(Number(full[3]));
  }

  if (!found) {
    var md = /(?:^|[^\d])(\d{1,2})\/(\d{1,2})(?![\d])/.exec(rest);
    if (!md) {
      md = /^\s*(\d{1,2})-(\d{1,2})(?![\d])/.exec(rest);
    }
    if (md && isValidYmd(Number(today.slice(0, 4)), Number(md[1]), Number(md[2]))) {
      found = md[0].replace(/^[^\d]/, '');
      date = today.slice(0, 4) + '-' + pad2(Number(md[1])) + '-' + pad2(Number(md[2]));
    }
  }

  if (!found) {
    if (rest.indexOf('그저께') >= 0) {
      found = '그저께';
      date = shiftDays(today, -2);
    } else if (rest.indexOf('그제') >= 0) {
      found = '그제';
      date = shiftDays(today, -2);
    } else if (rest.indexOf('어제') >= 0) {
      found = '어제';
      date = shiftDays(today, -1);
    } else if (rest.indexOf('오늘') >= 0) {
      found = '오늘';
      date = today;
    }
  }

  if (found) {
    rest = rest.replace(found, ' ');
  }
  if (date > today) {
    date = today;
    low = true;
  }
  return { date: date, rest: rest, low: low };
}

/**
 * 텍스트에서 금액 토큰을 모두 뽑고 제거한다.
 * 각 후보에 확신 점수를 붙인다. 통화 기호·단위가 붙은 것 3, 소수점이 있는 것 2, 맨 숫자 1.
 * @return {{amounts: !Array<!Object>, rest: string, invalid: boolean}}
 */
function extractAmounts(text, defaultCurrency) {
  var amounts = [];
  var spans = [];
  var invalid = false;
  NUM_RE.lastIndex = 0;
  var m;
  while ((m = NUM_RE.exec(text)) !== null) {
    var start = m.index;
    var end = m.index + m[0].length;

    var before = text.slice(0, start);
    var prefix = /(\$|₩)[ ]?$/.exec(before);
    if (prefix) {
      start -= prefix[0].length;
    }

    var after = text.slice(end);
    var unitMatch = UNIT_RE.exec(after);
    var unitKey = null;
    if (unitMatch) {
      unitKey = unitMatch[1].toLowerCase();
      end += unitMatch[0].length;
    } else if (BAD_UNIT_RE.test(after)) {
      invalid = true;
    }

    var digits = m[1];
    var numeric;
    var hasDecimal;
    if (/^\d{1,3}(,\d{3})+/.test(digits)) {
      numeric = Number(digits.replace(/,/g, ''));
      hasDecimal = /\.\d/.test(digits);
    } else {
      numeric = Number(digits.replace(',', '.'));
      hasDecimal = /[.,]\d/.test(digits);
    }

    var spec = unitKey ? UNIT_SPEC[unitKey] : null;
    var currency = spec ? spec.currency
      : (prefix ? (prefix[1] === '₩' ? 'KRW' : 'USD') : defaultCurrency);
    var amount = spec ? numeric * spec.mul : numeric;
    var score = (spec || prefix) ? 3 : (hasDecimal ? 2 : 1);

    amounts.push({ amount: round2(amount), currency: currency, score: score });
    spans.push([start, end]);
  }

  return { amounts: amounts, spans: spans, rest: removeSpans(text, spans), invalid: invalid };
}

/** 텍스트에서 구간들을 지운다. 구간은 [start, end) 이며 겹치지 않는다. */
function removeSpans(text, spans) {
  var rest = text;
  var sorted = (spans || []).slice().sort(function (a, b) { return b[0] - a[0]; });
  for (var i = 0; i < sorted.length; i++) {
    rest = rest.slice(0, sorted[i][0]) + ' ' + rest.slice(sorted[i][1]);
  }
  return rest;
}

/**
 * 금액 후보가 여럿일 때 하나를 고른다.
 * 점수가 가장 높은 후보들 중 마지막 것을 고르고, 그런 후보가 둘 이상이면 ambiguous 로 표시한다.
 * "물 2병 5.99" → 5.99 (소수점이 있어 확실). "코스트코 2 3" → 3 이지만 ambiguous.
 * @param {!Array<!Object>} amounts
 * @return {{picked: ?Object, ambiguous: boolean}}
 */
function pickAmount(amounts) {
  if (!amounts || amounts.length === 0) {
    return { picked: null, ambiguous: false };
  }
  var best = -1;
  amounts.forEach(function (a) {
    if (a.score > best) {
      best = a.score;
    }
  });
  var top = amounts.filter(function (a) { return a.score === best; });
  return { picked: top[top.length - 1], ambiguous: top.length > 1 };
}

/** 연속 공백을 한 칸으로 줄이고 양끝을 다듬는다. */
function squeeze(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** 힌트 낱말을 텍스트에서 지운다. */
function stripHints(text, hints) {
  var out = text;
  (hints || []).forEach(function (h) {
    if (h) {
      out = out.split(h).join(' ');
    }
  });
  return squeeze(out);
}

/**
 * 세부예산 간 예산 이동 의도를 읽는다.
 * "이동 예비비→식료품 50", "이동 예비비 -> 식료품 50", "예비비에서 식료품으로 50 이동"
 * @return {?{from: string, to: string, amountText: string}}
 */
function extractMove(text) {
  var a = /이동\s+(\S+?)\s*(?:→|->|>)\s*(\S+)\s+(.+)$/.exec(text);
  if (a) {
    return { from: a[1], to: a[2], amountText: a[3] };
  }
  var b = /^(\S+?)에서\s+(\S+?)(?:으로|로)\s+(.+?)\s*(?:이동|옮겨|옮기기|옮겨줘)\s*$/.exec(text);
  if (b) {
    return { from: b[1], to: b[2], amountText: b[3] };
  }
  return null;
}

/**
 * Telegram 메시지를 파싱한다.
 * @param {string} text 원문
 * @param {{today: string, defaultCurrency: string, fxUsdKrw: number, incomeHints: (Array<string>|undefined)}} ctx
 * @return {?Object} 파싱 결과. 입력이 비면 null.
 */
function parseMessage(text, ctx) {
  if (text === null || text === undefined) {
    return null;
  }
  var raw = String(text).trim();
  if (!raw) {
    return null;
  }
  var options = ctx || {};
  var today = options.today;
  var defaultCurrency = options.defaultCurrency || 'USD';
  var fx = Number(options.fxUsdKrw) || 0;
  var incomeHints = options.incomeHints && options.incomeHints.length ? options.incomeHints : INCOME_HINTS;

  var result = {
    intent: 'unknown',
    type: '',
    amount: null,
    currency: '',
    amount_usd: null,
    amountCandidates: [],
    ambiguous: false,
    refund: false,
    date: today,
    merchantText: '',
    merchantTextRaw: '',
    memo: '',
    confidence: 'high'
  };

  // 세부예산 간 이동은 금액 파싱보다 먼저 본다. "이동 예비비→식료품 50" 의 50 은 지출이 아니다.
  var move = extractMove(raw);
  if (move) {
    var moveAmt = extractAmounts(move.amountText, defaultCurrency);
    var movePick = pickAmount(moveAmt.amounts);
    if (movePick.picked) {
      result.intent = 'move';
      result.moveFrom = move.from;
      result.moveTo = move.to;
      result.amount = movePick.picked.amount;
      result.currency = movePick.picked.currency;
      result.amount_usd = movePick.picked.currency === 'KRW'
        ? (fx > 0 ? round2(movePick.picked.amount / fx) : null)
        : round2(movePick.picked.amount);
      return result;
    }
  }

  var dateRes = extractDate(raw, today);
  var amtRes = extractAmounts(dateRes.rest, defaultCurrency);
  var low = dateRes.low;

  // 지원하지 않는 단위(12.5k 등)가 붙어 있으면 금액을 신뢰할 수 없다.
  if (amtRes.invalid) {
    result.intent = 'unknown';
    result.date = dateRes.date;
    result.confidence = 'low';
    result.memo = raw;
    return result;
  }

  if (amtRes.amounts.length > 0) {
    var pick = pickAmount(amtRes.amounts);
    var picked = pick.picked;
    if (pick.ambiguous) {
      low = true;
    }
    var isRefund = REFUND_HINTS.some(function (h) { return raw.indexOf(h) >= 0; });
    var isIncome = !isRefund && incomeHints.some(function (h) { return raw.indexOf(h) >= 0; });
    var sign = isRefund ? -1 : 1;

    result.intent = 'record';
    result.type = isIncome ? 'income' : 'expense';
    result.refund = isRefund;
    result.amount = round2(sign * picked.amount);
    result.currency = picked.currency;
    result.amount_usd = picked.currency === 'KRW'
      ? (fx > 0 ? round2(sign * picked.amount / fx) : null)
      : round2(sign * picked.amount);
    result.amountCandidates = amtRes.amounts.map(function (a) {
      return { amount: a.amount, currency: a.currency };
    });
    result.ambiguous = pick.ambiguous;
    result.date = dateRes.date;

    // 확실한 금액 하나가 골라졌으면 나머지 숫자("7-11", "2병")는 가맹점 이름의 일부로 남긴다.
    var pickedIndex = amtRes.amounts.indexOf(picked);
    var merchantSource = pick.ambiguous
      ? amtRes.rest
      : removeSpans(dateRes.rest, [amtRes.spans[pickedIndex]]);
    var merchantRaw = squeeze(merchantSource);
    result.merchantTextRaw = merchantRaw;
    result.merchantText = stripHints(merchantRaw, incomeHints.concat(REFUND_HINTS));
    if (!result.merchantText) {
      low = true;
    }
    if (result.amount_usd === null) {
      low = true;
    }
    result.confidence = low ? 'low' : 'high';
    if (result.confidence === 'low') {
      result.memo = raw;
    }
    return result;
  }

  // 금액이 없는 경우: 취소 → 조회 → 알 수 없음 순으로 판정한다.
  result.date = dateRes.date;
  if (/취소/.test(raw) || /\bundo\b/i.test(raw)) {
    result.intent = 'undo';
    return result;
  }
  if (/얼마\s*남/.test(raw) || /남았/.test(raw) || /남은/.test(raw) ||
      /잔액/.test(raw) || /상태/.test(raw) || /요약/.test(raw) || raw === '오늘') {
    result.intent = 'query';
    return result;
  }
  result.intent = 'unknown';
  result.merchantTextRaw = squeeze(dateRes.rest);
  result.merchantText = result.merchantTextRaw;
  result.confidence = 'low';
  return result;
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseMessage: parseMessage,
    extractDate: extractDate,
    extractAmounts: extractAmounts,
    extractMove: extractMove,
    pickAmount: pickAmount,
    round2: round2,
    shiftDays: shiftDays,
    INCOME_HINTS: INCOME_HINTS,
    REFUND_HINTS: REFUND_HINTS
  };
}
