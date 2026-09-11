/**
 * MigrationMap.js — 순수 모듈. 기존 월별 탭의 한 행을 Transactions 행으로 바꾼다.
 * Google 서비스에 의존하지 않는다. 시트 읽기·쓰기는 Migration.js 가 한다.
 *
 * GAS 는 파일을 한 전역 스코프에 이어 붙이므로 다른 모듈과 이름이 겹치지 않도록
 * 내부 헬퍼에는 mig 접두사를 붙인다.
 */

/** 소수 둘째 자리 반올림. */
function migRoundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function migPad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** 실제로 존재하는 날짜인지 확인한다. */
function migIsValidYmd(y, m, d) {
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 탭 이름을 id 에 쓸 수 있는 형태로 줄인다. */
function migSlug(name) {
  return String(name === null || name === undefined ? '' : name)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}_-]/gu, '');
}

/**
 * 원본 탭·행에서 결정되는 고정 id. 같은 행을 두 번 이관해도 id 가 같아서 건너뛸 수 있다.
 * @param {string} tabName
 * @param {number} rowNumber 원본 시트의 행 번호
 * @return {string}
 */
function migRowId(tabName, rowNumber) {
  return 'mig_' + migSlug(tabName) + '_' + rowNumber;
}

/**
 * 옛 시트의 금액 셀을 숫자와 통화로 바꾼다.
 * "1,234.56", "$85.89", "50,000원", "5만원", "(123)", -123 을 모두 받는다.
 * @param {(string|number|null|undefined)} value
 * @param {string} defaultCurrency
 * @return {?{amount: number, currency: string, negative: boolean}} 읽지 못하면 null
 */
function normalizeLegacyAmount(value, defaultCurrency) {
  var fallback = defaultCurrency || 'USD';
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    if (!isFinite(value) || value === 0) {
      return null;
    }
    return { amount: migRoundMoney(Math.abs(value)), currency: fallback, negative: value < 0 };
  }

  var s = String(value).trim();
  if (!s) {
    return null;
  }
  var negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^\s*-/.test(s)) {
    negative = true;
  }

  var currency = null;
  if (/₩|원|krw/i.test(s)) {
    currency = 'KRW';
  }
  if (/\$|usd|불|달러/i.test(s)) {
    currency = 'USD';
  }
  var isManWon = /만\s*원?/.test(s);

  var digits = s.replace(/[^\d.]/g, '');
  if (!digits || !/\d/.test(digits)) {
    return null;
  }
  var num = Number(digits);
  if (!isFinite(num) || num === 0) {
    return null;
  }
  if (isManWon) {
    num *= 10000;
    currency = currency || 'KRW';
  }
  return { amount: migRoundMoney(num), currency: currency || fallback, negative: negative };
}

/**
 * 옛 시트의 날짜 셀을 'YYYY-MM-DD' 로 바꾼다.
 * Date 값은 호출자가 미리 문자열로 정규화해서 넘긴다(시간대 어긋남 방지).
 * "2025-01-05", "2025/1/5", "1/5", "1월 5일", 5(일자만) 를 받는다.
 * @param {(string|number|null|undefined)} value
 * @param {string} fallbackMonth 'YYYY-MM'. 연도·월이 없는 값을 채울 때 쓴다.
 * @return {?string} 읽지 못하면 null
 */
function normalizeLegacyDate(value, fallbackMonth) {
  var month = /^\d{4}-\d{2}$/.test(String(fallbackMonth || '').trim())
    ? String(fallbackMonth).trim()
    : '';
  var year = month ? Number(month.slice(0, 4)) : 0;
  var monthNum = month ? Number(month.slice(5, 7)) : 0;

  var s = String(value === null || value === undefined ? '' : value).trim();
  if (!s) {
    return month ? month + '-01' : null;
  }

  var full = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (full) {
    var fy = Number(full[1]);
    var fm = Number(full[2]);
    var fd = Number(full[3]);
    return migIsValidYmd(fy, fm, fd) ? fy + '-' + migPad2(fm) + '-' + migPad2(fd) : null;
  }

  var md = /^(\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (md && year) {
    var mm = Number(md[1]);
    var dd = Number(md[2]);
    return migIsValidYmd(year, mm, dd) ? year + '-' + migPad2(mm) + '-' + migPad2(dd) : null;
  }

  var kr = /^(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/.exec(s);
  if (kr && year) {
    var km = Number(kr[1]);
    var kd = Number(kr[2]);
    return migIsValidYmd(year, km, kd) ? year + '-' + migPad2(km) + '-' + migPad2(kd) : null;
  }

  var dayOnly = /^(\d{1,2})\s*일?$/.exec(s);
  if (dayOnly && month) {
    var d = Number(dayOnly[1]);
    return migIsValidYmd(year, monthNum, d) ? month + '-' + migPad2(d) : null;
  }

  return null;
}

/** 라벨이 목록 중 하나와 맞는지 본다(대소문자·공백 무시). */
function migMatchesLabel(value, labels) {
  var v = String(value || '').trim().toLowerCase();
  if (!v) {
    return false;
  }
  return (labels || []).some(function (label) {
    return v === String(label).trim().toLowerCase();
  });
}

/**
 * 원본 한 행을 Transactions 행으로 바꾼다.
 * @param {!Object} sourceRow 원본 헤더를 키로 갖는 객체
 * @param {!Object} map 대상 필드 → 원본 헤더 이름
 * @param {!Object} ctx {tabName, rowNumber, month, defaultCurrency, fxUsdKrw, now,
 *                       defaultType, defaultKind, defaultEnvelope, incomeLabels, expenseLabels}
 * @return {!Object} {status: 'ok'|'blank'|'error', transaction?, reason?}
 */
function buildTransactionFromRow(sourceRow, map, ctx) {
  var options = ctx || {};
  var columns = map || {};
  var row = sourceRow || {};

  function pick(field) {
    var header = columns[field];
    if (!header) {
      return '';
    }
    var v = row[header];
    return v === null || v === undefined ? '' : v;
  }

  var merchant = String(pick('merchant')).trim();
  var amountInfo = normalizeLegacyAmount(pick('amount'), options.defaultCurrency || 'USD');

  if (!amountInfo && !merchant) {
    return { status: 'blank' };
  }
  if (!amountInfo) {
    return { status: 'error', reason: '금액을 읽지 못했습니다: "' + pick('amount') + '"' };
  }

  var date = normalizeLegacyDate(pick('date'), options.month);
  if (!date) {
    return { status: 'error', reason: '날짜를 읽지 못했습니다: "' + pick('date') + '"' };
  }

  var rawType = String(pick('type')).trim();
  var type = '';
  if (rawType) {
    if (migMatchesLabel(rawType, options.incomeLabels || ['수입', 'income', '입금'])) {
      type = 'income';
    } else if (migMatchesLabel(rawType, options.expenseLabels || ['지출', 'expense', '출금'])) {
      type = 'expense';
    }
  }
  if (!type) {
    // 유형 열이 없으면 음수를 수입으로 본다. 옛 시트에서 흔한 표기다.
    type = amountInfo.negative ? 'income' : (options.defaultType || 'expense');
  }

  var kind = String(pick('kind')).trim() || options.defaultKind || 'variable';
  var envelope = String(pick('envelope')).trim();
  if (!envelope && type === 'expense' && kind === 'variable') {
    envelope = options.defaultEnvelope || '';
  }

  var fx = Number(options.fxUsdKrw) || 0;
  var amountUsd = amountInfo.currency === 'KRW'
    ? (fx > 0 ? migRoundMoney(amountInfo.amount / fx) : null)
    : migRoundMoney(amountInfo.amount);
  if (amountUsd === null) {
    return { status: 'error', reason: 'KRW 환산에 쓸 fx_usd_krw 가 없습니다.' };
  }

  var now = options.now || '';
  return {
    status: 'ok',
    transaction: {
      id: migRowId(options.tabName, options.rowNumber),
      date: date,
      type: type,
      kind: kind,
      category: String(pick('category')).trim(),
      envelope: envelope,
      merchant: merchant,
      amount: amountInfo.amount,
      currency: amountInfo.currency,
      amount_usd: amountUsd,
      recurring_id: '',
      status: 'active',
      memo: String(pick('memo')).trim(),
      payer: String(pick('payer')).trim(),
      source: 'migration',
      created_at: now,
      updated_at: now,
      updated_by: 'migration'
    }
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildTransactionFromRow: buildTransactionFromRow,
    normalizeLegacyAmount: normalizeLegacyAmount,
    normalizeLegacyDate: normalizeLegacyDate,
    migRowId: migRowId,
    migSlug: migSlug
  };
}
