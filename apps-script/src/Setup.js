/**
 * Setup.js — 시트 스키마 생성. runSetupAll() 한 번으로 docs/SHEET_SCHEMA.md 대로 시트를 만든다.
 * 모든 함수는 멱등이다. 기존 데이터는 절대 건드리지 않는다.
 */

/**
 * 탭별 드롭다운(데이터 유효성) 대상 열.
 * 값이 문자열이면 ENUMS 키, 'ENVELOPES' 면 Config.envelopes 에서 읽는다.
 */
var VALIDATIONS = {
  Transactions: {
    type: 'type',
    kind: 'kind',
    status: 'status',
    currency: 'currency',
    source: 'source',
    envelope: 'ENVELOPES'
  },
  Recurring: {
    kind: 'kind',
    currency: 'currency',
    active: 'active'
  },
  Budgets: {
    envelope: 'ENVELOPES',
    carryover: 'carryover'
  },
  Merchants: {
    type: 'type',
    kind: 'kind',
    envelope: 'ENVELOPES'
  },
  Debts: {
    currency: 'currency'
  },
  Assets: {
    currency: 'currency'
  },
  Goals: {
    horizon: 'horizon',
    linked_envelope: 'ENVELOPES'
  }
};

/** 초기 Recurring 시드. 금액은 사용자가 시트에서 수정한다. */
var RECURRING_SEED = [
  ['R01', '하우스 렌트', 'fixed', '주거비', 2100, 'USD', 1, 'fixed', 0, 'Y', '', 'expense'],
  ['R02', '관리비', 'fixed', '주거비', 207, 'USD', 1, 'fixed', 15, 'Y', '', 'expense'],
  ['R03', '어린이집', 'fixed', '교육비', 350, 'USD', 4, 'fixed', 0, 'Y', '', 'expense'],
  ['R04', '통신비', 'fixed', '통신비', 80, 'USD', 1, 'fixed', 10, 'Y', '', 'expense'],
  ['R05', '월 구독료', 'fixed', '구독', 173, 'USD', 1, 'fixed', 0, 'Y', '', 'expense'],
  ['R06', '유류비', 'fixed', '유류비', 250, 'USD', 1, 'fixed', 30, 'Y', 'ADR-0003 (c) 미결: variable 전환 가능', 'expense'],
  ['R07', '주일헌금', 'fixed', '헌금', 160, 'USD', 1, 'fixed', 0, 'Y', '', 'expense'],
  ['R08', '십일조', 'fixed', '십일조', '', 'USD', 26, 'income_pct:7', 0, 'Y', '그 달 수입 합의 7%', 'expense'],
  ['R09', '부채상환(미국)', 'fixed', '부채상환', '', 'USD', 15, 'fixed', 0, 'Y', '금액은 Debts 기준으로 입력', 'expense'],
  ['R10', '자동차 보험', 'fixed', '보험', '', 'USD', 1, 'fixed', 0, 'Y', '', 'expense'],
  ['R11', '건강보험(한국)', 'fixed', '보험', '', 'USD', 1, 'fixed', 0, 'Y', '', 'expense'],
  ['R12', '한국 대출 상환', 'fixed', '부채상환', '', 'KRW', 1, 'fixed', 5, 'Y', '한국 대출 월 상환 합계. 금액은 Debts 기준', 'expense']
];
// 실제 금액은 저장소에 두지 않는다. apps-script/PersonalSeed.js.example 을 보고
// src/PersonalSeed.js(.gitignore 대상)를 만들어 applyPersonalDefaults() 로 덮어쓴다.

/** 초기 Merchants 사전 시드. keyword, type, kind, category, envelope, recurring_id, hit_count, last_used */
var MERCHANTS_SEED = [
  ['코스트코', 'expense', 'variable', '식료품', '식료품', '', 0, ''],
  ['costco', 'expense', 'variable', '식료품', '식료품', '', 0, ''],
  ['세이프웨이', 'expense', 'variable', '식료품', '식료품', '', 0, ''],
  ['safeway', 'expense', 'variable', '식료품', '식료품', '', 0, ''],
  ['밤부마켓', 'expense', 'variable', '식료품', '식료품', '', 0, ''],
  ['주유', 'expense', 'fixed', '유류비', '', 'R06', 0, ''],
  ['gas', 'expense', 'fixed', '유류비', '', 'R06', 0, ''],
  ['관리비', 'expense', 'fixed', '주거비', '', 'R02', 0, ''],
  ['통신비', 'expense', 'fixed', '통신비', '', 'R04', 0, ''],
  ['레슨', 'income', 'variable', '영주 레슨', '', '', 0, '']
];

/**
 * 실제 헤더가 기대 헤더의 앞부분과 정확히 같고, 뒤쪽 열만 모자란지 확인한다.
 * @param {!Array<string>} actual
 * @param {!Array<string>} expected
 * @return {boolean}
 */
function isHeaderPrefix(actual, expected) {
  if (actual.length >= expected.length) {
    return false;
  }
  for (var i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i]) {
      return false;
    }
  }
  return true;
}

/** 모자란 뒤쪽 헤더를 마지막 열 뒤에 붙인다. 기존 데이터는 건드리지 않는다. */
function appendMissingHeaders(sheet, existingCount, headers) {
  var missing = headers.slice(existingCount);
  if (missing.length === 0) {
    return 0;
  }
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, existingCount + 1, 1, missing.length).setValues([missing]);
  return missing.length;
}

/**
 * 없는 탭은 만들고, 있는 탭은 헤더만 검증한다.
 * 헤더가 다르면 throw 하고 데이터는 건드리지 않는다.
 */
function setupSheet() {
  var ss = getSpreadsheet();
  Object.keys(SHEETS).forEach(function (key) {
    var spec = SHEETS[key];
    var sheet = ss.getSheetByName(spec.name);
    if (!sheet) {
      sheet = ss.insertSheet(spec.name);
    }
    if (spec.headers.length === 0) {
      return; // 수식 전용 탭(Monthly_View, Dashboard)
    }
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0 || sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
    } else {
      var actual = sheet.getRange(1, 1, 1, Math.max(lastCol, spec.headers.length)).getValues()[0]
        .map(function (h) { return String(h).trim(); })
        .filter(function (h) { return h !== ''; });
      var expected = spec.headers.join('|');
      if (actual.join('|') !== expected) {
        // extendable 탭(Log)은 뒤에 열이 추가된 경우에 한해 헤더를 이어붙인다.
        // 다른 탭은 종전대로 throw 하고 데이터를 건드리지 않는다.
        if (spec.extendable && isHeaderPrefix(actual, spec.headers)) {
          appendMissingHeaders(sheet, actual.length, spec.headers);
        } else {
          throw new Error(
            '탭 "' + spec.name + '" 헤더 불일치.\n기대: ' + expected + '\n실제: ' + actual.join('|') +
            '\n데이터는 변경하지 않았습니다. 헤더를 수동으로 맞춘 뒤 다시 실행하세요.'
          );
        }
      }
    }
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, spec.headers.length).setFontWeight('bold');
  });

  seedConfigDefaults();
  applyValidations();
  return '설정 완료: ' + Object.keys(SHEETS).length + '개 탭';
}

/** Config 탭에 필수 키를 기본값과 함께 삽입한다. 이미 있으면 건너뛴다. */
function seedConfigDefaults() {
  var sheet = getSheet(SHEETS.CONFIG.name);
  var existing = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r) {
      existing[String(r[0]).trim()] = true;
    });
  }
  var toAdd = CONFIG_DEFAULTS.filter(function (pair) {
    return !existing[pair[0]];
  });
  if (toAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 2).setValues(toAdd);
  }
  clearConfigCache();
  return toAdd.length;
}

/** 열거형 열에 드롭다운을 건다. Config.envelopes 는 값 목록으로 반영한다. */
function applyValidations() {
  var envelopes = getConfigList('envelopes');
  Object.keys(VALIDATIONS).forEach(function (tabName) {
    var sheet = getSheet(tabName);
    var headers = readHeaders(tabName);
    var maxRows = sheet.getMaxRows();
    if (maxRows < 2) {
      return;
    }
    var map = VALIDATIONS[tabName];
    Object.keys(map).forEach(function (colName) {
      var idx = headers.indexOf(colName);
      if (idx < 0) {
        return;
      }
      var values = map[colName] === 'ENVELOPES' ? envelopes : ENUMS[map[colName]];
      if (!values || values.length === 0) {
        return;
      }
      var rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(values, true)
        .setAllowInvalid(true)
        .build();
      sheet.getRange(2, idx + 1, maxRows - 1, 1).setDataValidation(rule);
    });
  });
}

/** Recurring 탭이 비어 있을 때만 기본 고정비 항목을 넣는다. */
function seedRecurring() {
  var sheet = getSheet(SHEETS.RECURRING.name);
  if (sheet.getLastRow() >= 2) {
    return 0;
  }
  sheet.getRange(2, 1, RECURRING_SEED.length, SHEETS.RECURRING.headers.length)
    .setValues(RECURRING_SEED);
  return RECURRING_SEED.length;
}

/** Merchants 탭이 비어 있을 때만 기본 사전을 넣는다. */
function seedMerchants() {
  var sheet = getSheet(SHEETS.MERCHANTS.name);
  if (sheet.getLastRow() >= 2) {
    return 0;
  }
  sheet.getRange(2, 1, MERCHANTS_SEED.length, SHEETS.MERCHANTS.headers.length)
    .setValues(MERCHANTS_SEED);
  return MERCHANTS_SEED.length;
}

/**
 * 해당 월의 Budgets 행이 없으면 Config.envelopes 마다 amount 0, carryover reset 으로 넣는다.
 * @param {string=} month YYYY-MM. 생략하면 이번 달.
 */
function seedBudgets(month) {
  var yyyyMm = month || currentMonthStr();
  var sheet = getSheet(SHEETS.BUDGETS.name);
  var rows = readAll(SHEETS.BUDGETS.name);
  var existing = {};
  rows.forEach(function (r) {
    if (String(r.month).trim() === yyyyMm) {
      existing[String(r.envelope).trim()] = true;
    }
  });
  var toAdd = getConfigList('envelopes')
    .filter(function (env) { return !existing[env]; })
    .map(function (env) { return [yyyyMm, env, 0, 'reset']; });
  if (toAdd.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 4).setValues(toAdd);
  }
  return toAdd.length;
}

/**
 * 봉투 목록을 바꾼다. Config.envelopes 를 쓰고 드롭다운을 다시 건다.
 * @param {!Array<string>} names
 */
function setEnvelopes(names) {
  var list = (names || []).map(function (n) { return String(n).trim(); }).filter(Boolean);
  if (!list.length) {
    throw new Error('setEnvelopes: 봉투가 비어 있습니다.');
  }
  setConfig('envelopes', list.join(','));
  applyValidations();
  return list.length;
}

/**
 * 해당 월의 봉투 예산 금액을 정한다. 행이 있으면 amount 만 바꾸고(carryover 유지), 없으면 추가한다.
 * @param {string} month 'YYYY-MM'
 * @param {!Object<string, number>} amounts 봉투 → 금액
 * @return {number} 손댄 행 수
 */
function applyBudgetAmounts(month, amounts) {
  var yyyyMm = month || currentMonthStr();
  var sheet = getSheet(SHEETS.BUDGETS.name);
  var headers = readHeaders(SHEETS.BUDGETS.name);
  var amountCol = headers.indexOf('amount') + 1;
  var rows = readAll(SHEETS.BUDGETS.name);
  var touched = 0;
  Object.keys(amounts || {}).forEach(function (envelope) {
    var hit = null;
    rows.forEach(function (r) {
      if (String(r.month).trim() === yyyyMm && String(r.envelope).trim() === envelope) {
        hit = r;
      }
    });
    if (hit) {
      sheet.getRange(hit._row, amountCol).setValue(Number(amounts[envelope]) || 0);
    } else {
      appendRow(SHEETS.BUDGETS.name, {
        month: yyyyMm, envelope: envelope, amount: Number(amounts[envelope]) || 0, carryover: 'reset'
      });
    }
    touched++;
  });
  return touched;
}

/** 전체 초기화. 두 번 실행해도 결과가 같다(멱등). */
function runSetupAll() {
  var result = [];
  result.push(setupSheet());
  result.push('Recurring 시드 ' + seedRecurring() + '행');
  result.push('Merchants 시드 ' + seedMerchants() + '행');
  result.push('Budgets 시드 ' + seedBudgets() + '행');
  result.push(buildMonthlyView());
  result.push(buildDashboard());
  var msg = result.join(' / ');
  Logger.log(msg);
  return msg;
}
