/**
 * Config.js — 탭 스키마 상수, Config 탭 조회, Script Properties 비밀값 조회.
 * 이 파일은 GAS 전용이다(SpreadsheetApp / PropertiesService / CacheService 의존).
 */

/**
 * 탭 이름과 헤더 정의. docs/SHEET_SCHEMA.md 와 글자 단위로 동일해야 한다.
 * headers 가 빈 배열인 탭(Monthly_View, Dashboard)은 수식 전용이라 헤더를 강제하지 않는다.
 */
var SHEETS = {
  TRANSACTIONS: {
    name: 'Transactions',
    headers: [
      'id', 'date', 'type', 'kind', 'category', 'envelope', 'merchant', 'amount',
      'currency', 'amount_usd', 'recurring_id', 'status', 'memo', 'payer', 'source',
      'created_at', 'updated_at', 'updated_by'
    ]
  },
  RECURRING: {
    name: 'Recurring',
    headers: [
      'id', 'name', 'kind', 'category', 'expected_amount', 'currency', 'due_day',
      'amount_rule', 'tolerance_pct', 'active', 'notes'
    ]
  },
  BUDGETS: {
    name: 'Budgets',
    headers: ['month', 'envelope', 'amount', 'carryover']
  },
  MERCHANTS: {
    name: 'Merchants',
    headers: [
      'keyword', 'type', 'kind', 'category', 'envelope', 'recurring_id',
      'hit_count', 'last_used'
    ]
  },
  DEBTS: {
    name: 'Debts',
    headers: [
      'id', 'name', 'principal', 'rate_pct', 'monthly_payment',
      'remaining_count', 'currency', 'notes'
    ]
  },
  ASSETS: {
    name: 'Assets',
    headers: ['snapshot_date', 'account', 'balance', 'currency']
  },
  GOALS: {
    name: 'Goals',
    headers: [
      'id', 'horizon', 'title', 'target_amount', 'deadline', 'linked_envelope', 'notes'
    ]
  },
  CONFIG: {
    name: 'Config',
    headers: ['key', 'value']
  },
  LOG: {
    name: 'Log',
    // extendable: 기존 탭에 뒤쪽 열이 없으면 throw 하지 않고 이어붙인다(Log 전용).
    extendable: true,
    headers: ['timestamp', 'telegram_id', 'raw_text', 'parsed_json', 'result', 'update_id']
  },
  MONTHLY_VIEW: {
    name: 'Monthly_View',
    headers: []
  },
  DASHBOARD: {
    name: 'Dashboard',
    headers: []
  }
};

/** Config 탭 필수 키와 기본값. setupSheet() 이 없는 키만 삽입한다. */
var CONFIG_DEFAULTS = [
  ['fx_usd_krw', '1332'],
  ['envelopes', '식료품,생필품,예비비'],
  ['default_currency', 'USD'],
  ['timezone', 'America/Los_Angeles'],
  ['allowed_telegram_ids', ''],
  ['daily_summary_hour', '7'],
  ['month_start_day', '1']
];

/** 열거형 값 목록. 데이터 유효성(드롭다운)과 검증에 함께 쓴다. */
var ENUMS = {
  type: ['income', 'expense', 'transfer'],
  kind: ['fixed', 'variable'],
  status: ['active', 'expected', 'confirmed', 'deleted'],
  carryover: ['reset', 'carry'],
  horizon: ['short', 'mid', 'long'],
  currency: ['USD', 'KRW'],
  active: ['Y', 'N'],
  source: ['telegram', 'web', 'recurring', 'csv', 'migration']
};

var CONFIG_CACHE_SECONDS = 300;

/**
 * 대상 스프레드시트를 연다.
 * Script Properties 에 SPREADSHEET_ID 가 있으면 그것을, 없으면 컨테이너 바인딩 시트를 쓴다.
 */
function getSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPREADSHEET_ID');
  if (id) {
    return SpreadsheetApp.openById(id);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error('SPREADSHEET_ID 스크립트 속성이 없고 바인딩된 스프레드시트도 없습니다.');
  }
  return active;
}

/**
 * Config 탭 전체를 key→value 객체로 읽는다. 5분 캐시.
 * @return {!Object<string,string>}
 */
function getConfigMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('config_map');
  if (cached) {
    return JSON.parse(cached);
  }
  var sheet = getSpreadsheet().getSheetByName(SHEETS.CONFIG.name);
  var map = {};
  if (sheet) {
    var values = sheet.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var key = String(values[i][0]).trim();
      if (key) {
        map[key] = values[i][1] === null || values[i][1] === undefined ? '' : String(values[i][1]).trim();
      }
    }
  }
  cache.put('config_map', JSON.stringify(map), CONFIG_CACHE_SECONDS);
  return map;
}

/**
 * Config 값을 쓴다. 키가 있으면 값만 바꾸고, 없으면 행을 추가한다. 캐시를 비운다.
 * @param {string} key
 * @param {string|number} value
 */
function setConfig(key, value) {
  var sheet = getSpreadsheet().getSheetByName(SHEETS.CONFIG.name);
  if (!sheet) {
    throw new Error('Config 탭이 없습니다. runSetupAll() 을 먼저 실행하세요.');
  }
  var lastRow = sheet.getLastRow();
  var values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) {
      sheet.getRange(i + 2, 2).setValue(value);
      clearConfigCache();
      return;
    }
  }
  sheet.appendRow([key, value]);
  clearConfigCache();
}

/** Config 캐시를 비운다. Config 값을 코드로 바꾼 직후 호출한다. */
function clearConfigCache() {
  CacheService.getScriptCache().remove('config_map');
}

/**
 * Config 탭에서 값 하나를 읽는다.
 * @param {string} key
 * @param {string=} fallback 없을 때 반환값. 생략하면 빈 문자열.
 * @return {string}
 */
function getConfig(key, fallback) {
  var map = getConfigMap();
  if (Object.prototype.hasOwnProperty.call(map, key) && map[key] !== '') {
    return map[key];
  }
  return fallback === undefined ? '' : fallback;
}

/**
 * 콤마 구분 Config 값을 배열로 읽는다.
 * @param {string} key
 * @return {!Array<string>}
 */
function getConfigList(key) {
  var raw = getConfig(key, '');
  if (!raw) {
    return [];
  }
  return raw.split(',').map(function (s) {
    return s.trim();
  }).filter(function (s) {
    return s !== '';
  });
}

/** Config 값을 숫자로 읽는다. */
function getConfigNumber(key, fallback) {
  var raw = getConfig(key, '');
  var n = Number(raw);
  return raw !== '' && !isNaN(n) ? n : fallback;
}

/**
 * Script Properties 에서 비밀값을 읽는다. 없으면 throw.
 * 비밀값은 저장소에 두지 않고 오직 Script Properties 에만 있다.
 * @param {string} key
 * @return {string}
 */
function getSecret(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) {
    throw new Error('Script Property "' + key + '" 가 설정되지 않았습니다. docs/SETUP.md 참고.');
  }
  return value;
}
