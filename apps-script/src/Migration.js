/**
 * Migration.js — 기존 월별 탭을 Transactions 원장으로 옮긴다.
 *
 * 이 파일은 옛 탭을 읽기만 한다. 지우거나 고치지 않는다.
 * 행 변환 규칙은 순수 모듈 MigrationMap.js 에 있고 여기서는 시트 입출력만 한다.
 *
 * 쓰는 순서
 *   1) previewMigrationSource('2025-01')  — 원본 헤더와 첫 세 행을 로그로 본다
 *   2) MIGRATION_MAP 을 채운다 (아래 상수)
 *   3) migrateAll()        — 쓰지 않고 결과만 보고한다 (dry run)
 *   4) migrateAllCommit()  — 실제로 Transactions 에 추가한다
 *
 * 같은 행은 두 번 들어가지 않는다. id 가 원본 탭 이름과 행 번호로 정해지기 때문이다.
 */

/**
 * 이관 설정. 실행 전에 사용자가 직접 채운다.
 * columns 의 값은 원본 탭의 헤더 이름이다. 해당 열이 없으면 빈 문자열로 둔다.
 */
var MIGRATION_MAP = {
  // 옮길 원본 탭. month 는 그 탭이 나타내는 달(YYYY-MM)이며 날짜에 연·월이 없을 때 채우는 데 쓴다.
  tabs: [
    // { name: '2025-01', month: '2025-01' },
    // { name: '2025-02', month: '2025-02' }
  ],
  columns: {
    date: '날짜',
    merchant: '내역',
    amount: '금액',
    category: '분류',
    envelope: '',
    kind: '',
    memo: '메모',
    type: '',
    payer: ''
  },
  defaults: {
    defaultType: 'expense',
    defaultKind: 'variable',
    defaultEnvelope: '기타',
    incomeLabels: ['수입', 'income', '입금'],
    expenseLabels: ['지출', 'expense', '출금']
  }
};

/** SHEETS 에 없는 임의의 탭을 헤더 키 객체 배열로 읽는다. _row 에 원본 행 번호를 담는다. */
function readSourceTab(tabName) {
  var sheet = getSpreadsheet().getSheetByName(tabName);
  if (!sheet) {
    throw new Error('원본 탭 "' + tabName + '" 을 찾지 못했습니다.');
  }
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) {
    return [];
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) {
        continue;
      }
      var v = values[i][c];
      // Date 값은 스크립트 시간대 기준으로 미리 문자열로 바꾼다(순수 모듈은 시간대를 모른다).
      obj[headers[c]] = (v instanceof Date) ? toDateStr(v) : (v === null || v === undefined ? '' : v);
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * 원본 탭의 헤더와 첫 세 행을 로그로 보여 준다. MIGRATION_MAP.columns 를 채울 때 쓴다.
 * @param {string} tabName
 * @return {string}
 */
function previewMigrationSource(tabName) {
  var sheet = getSpreadsheet().getSheetByName(tabName);
  if (!sheet) {
    var names = getSpreadsheet().getSheets().map(function (s) { return s.getName(); });
    var msg = '탭 "' + tabName + '" 없음. 현재 탭 목록: ' + names.join(', ');
    Logger.log(msg);
    return msg;
  }
  var rows = readSourceTab(tabName);
  var headers = rows.length
    ? Object.keys(rows[0]).filter(function (k) { return k !== '_row'; })
    : [];
  var lines = [
    '탭: ' + tabName,
    '헤더: ' + headers.join(' | '),
    '행 수: ' + rows.length
  ];
  rows.slice(0, 3).forEach(function (row) {
    lines.push('행 ' + row._row + ': ' + JSON.stringify(row));
  });
  var out = lines.join('\n');
  Logger.log(out);
  return out;
}

/** 이미 원장에 있는 id 집합. 멱등성 판정에 쓴다. */
function existingTransactionIds() {
  var seen = {};
  readAll(SHEETS.TRANSACTIONS.name).forEach(function (row) {
    seen[String(row.id).trim()] = true;
  });
  return seen;
}

/**
 * 탭 하나를 이관한다.
 * @param {string} tabName
 * @param {string} month 'YYYY-MM'
 * @param {boolean} commit true 일 때만 실제로 쓴다
 * @param {!Object=} seen 이미 있는 id 집합(여러 탭을 돌 때 재사용)
 * @return {!Object} {tab, total, created, skipped, blank, errors: []}
 */
function migrateTab(tabName, month, commit, seen) {
  var known = seen || existingTransactionIds();
  var rows = readSourceTab(tabName);
  var ctx = {
    tabName: tabName,
    month: month,
    defaultCurrency: getConfig('default_currency', 'USD'),
    fxUsdKrw: getConfigNumber('fx_usd_krw', 1332),
    now: nowIso(),
    defaultType: MIGRATION_MAP.defaults.defaultType,
    defaultKind: MIGRATION_MAP.defaults.defaultKind,
    defaultEnvelope: MIGRATION_MAP.defaults.defaultEnvelope,
    incomeLabels: MIGRATION_MAP.defaults.incomeLabels,
    expenseLabels: MIGRATION_MAP.defaults.expenseLabels
  };

  var report = { tab: tabName, total: rows.length, created: 0, skipped: 0, blank: 0, errors: [] };

  rows.forEach(function (row) {
    ctx.rowNumber = row._row;
    var result = buildTransactionFromRow(row, MIGRATION_MAP.columns, ctx);
    if (result.status === 'blank') {
      report.blank++;
      return;
    }
    if (result.status === 'error') {
      report.errors.push('행 ' + row._row + ': ' + result.reason);
      return;
    }
    var tx = result.transaction;
    if (known[tx.id]) {
      report.skipped++; // 이미 옮긴 행
      return;
    }
    if (commit) {
      appendRow(SHEETS.TRANSACTIONS.name, tx);
      known[tx.id] = true;
    }
    report.created++;
  });

  return report;
}

/** 여러 탭을 돌면서 보고서를 한 줄씩 만든다. */
function runMigration(commit) {
  if (!MIGRATION_MAP.tabs.length) {
    var msg = 'MIGRATION_MAP.tabs 가 비어 있습니다. previewMigrationSource 로 원본을 확인한 뒤 채우세요.';
    Logger.log(msg);
    return msg;
  }
  var seen = existingTransactionIds();
  var lines = [commit ? '=== 이관 실행 ===' : '=== 이관 미리보기 (쓰지 않음) ==='];
  var totalCreated = 0;
  var totalErrors = 0;

  MIGRATION_MAP.tabs.forEach(function (entry) {
    var report;
    try {
      report = migrateTab(entry.name, entry.month, commit === true, seen);
    } catch (err) {
      lines.push(entry.name + ': 실패 — ' + err);
      totalErrors++;
      return;
    }
    totalCreated += report.created;
    totalErrors += report.errors.length;
    lines.push(report.tab + ': 전체 ' + report.total + ' / 추가 ' + report.created +
      ' / 기존 건너뜀 ' + report.skipped + ' / 빈 행 ' + report.blank +
      ' / 오류 ' + report.errors.length);
    report.errors.slice(0, 10).forEach(function (e) {
      lines.push('  · ' + e);
    });
    if (report.errors.length > 10) {
      lines.push('  · 오류 ' + (report.errors.length - 10) + '건 더 있음');
    }
  });

  lines.push('합계: 추가 ' + totalCreated + '건, 오류 ' + totalErrors + '건');
  if (!commit) {
    lines.push('실제로 쓰려면 migrateAllCommit() 을 실행하세요.');
  }
  var out = lines.join('\n');
  Logger.log(out);
  logEvent('', 'migration', '', out.slice(0, 5000));
  return out;
}

/** 쓰지 않고 결과만 본다. */
function migrateAll() {
  return runMigration(false);
}

/** 실제로 Transactions 에 추가한다. 여러 번 실행해도 같은 행이 중복되지 않는다. */
function migrateAllCommit() {
  return runMigration(true);
}

/** 이관으로 들어온 행 수를 센다. */
function migrationReport() {
  var count = 0;
  readAll(SHEETS.TRANSACTIONS.name).forEach(function (row) {
    if (String(row.source).trim() === 'migration' && String(row.status).trim() !== 'deleted') {
      count++;
    }
  });
  var msg = '이관된 원장 행: ' + count + '건';
  Logger.log(msg);
  return msg;
}
