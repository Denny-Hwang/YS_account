/**
 * Views.js — Monthly_View 와 Dashboard 를 수식으로 다시 그린다.
 * 데이터를 넣지 않는다. 모든 집계는 수식이고 탭·열 참조는 SHEETS 상수에서 만든다.
 */

/** Monthly_View 블록별 시작 행. */
var MV_ROWS = {
  month: 1,
  incomeTitle: 3,
  incomeHeader: 4,
  incomeStart: 5,
  incomeCount: 20,
  fixedTitle: 26,
  fixedHeader: 27,
  fixedStart: 28,
  fixedCount: 20,
  envTitle: 49,
  envHeader: 50,
  envStart: 51,
  envCount: 10,
  catTitle: 62,
  catHeader: 63,
  catStart: 64,
  catCount: 20,
  ledgerTitle: 86,
  ledgerHeader: 87,
  ledgerStart: 88
};

/** 0-based 열 번호를 A1 표기 문자로 바꾼다. */
function columnLetter(index) {
  var n = index + 1;
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 탭 스펙과 헤더 이름으로 열 전체 범위 참조를 만든다. 예: 'Transactions'!$J$2:$J */
function colRange(spec, header) {
  var idx = spec.headers.indexOf(header);
  if (idx < 0) {
    throw new Error('탭 ' + spec.name + ' 에 열 ' + header + ' 이 없습니다.');
  }
  var letter = columnLetter(idx);
  return "'" + spec.name + "'!$" + letter + '$2:$' + letter;
}

/** 탭 스펙과 헤더 이름으로 특정 행의 셀 참조를 만든다. 예: 'Recurring'!$B2 */
function colCell(spec, header, row) {
  var idx = spec.headers.indexOf(header);
  if (idx < 0) {
    throw new Error('탭 ' + spec.name + ' 에 열 ' + header + ' 이 없습니다.');
  }
  return "'" + spec.name + "'!$" + columnLetter(idx) + row;
}

/** 날짜 열이 텍스트든 날짜값이든 'YYYY-MM' 으로 비교하는 조건식. */
function monthPredicate(spec, monthCell) {
  return '(LEFT(TEXT(' + colRange(spec, 'date') + ',"yyyy-mm-dd"),7)=' + monthCell + ')';
}

/** Config 의 환율 값을 읽는 수식 조각. */
function fxFormula() {
  return 'IFERROR(VLOOKUP("fx_usd_krw",' + "'" + SHEETS.CONFIG.name + "'" +
    '!$A$2:$B,2,FALSE),1)';
}

/** 탭에 최소 행 수를 보장한다. */
function ensureRows(sheet, needed) {
  if (sheet.getMaxRows() < needed) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  }
}

/** 탭의 기존 차트를 모두 떼어낸다. */
function removeCharts(sheet) {
  sheet.getCharts().forEach(function (chart) {
    sheet.removeChart(chart);
  });
}

/**
 * Monthly_View 탭을 지우고 다시 그린다.
 * B1 의 월을 바꾸면 모든 블록이 따라 움직인다.
 */
function buildMonthlyView() {
  var TX = SHEETS.TRANSACTIONS;
  var REC = SHEETS.RECURRING;
  var BUD = SHEETS.BUDGETS;
  var sheet = getSheet(SHEETS.MONTHLY_VIEW.name);
  removeCharts(sheet);
  sheet.clear();
  ensureRows(sheet, MV_ROWS.ledgerStart + 200);

  var M = '$B$1';
  var txMonth = monthPredicate(TX, M);
  var notDeleted = '(' + colRange(TX, 'status') + '<>"deleted")';
  // "실제" 는 active/confirmed 만 센다. expected 는 예정이라 합계에 넣지 않는다(웹앱과 같은 기준).
  var counted = '((' + colRange(TX, 'status') + '="active")+(' + colRange(TX, 'status') + '="confirmed")+(' + colRange(TX, 'status') + '="committed"))';
  var amountUsd = colRange(TX, 'amount_usd');

  // 월 선택
  sheet.getRange('A1').setValue('월 선택');
  sheet.getRange('B1').setValue(Utilities.formatDate(
    new Date(), getConfig('timezone', 'America/Los_Angeles'), 'yyyy-MM'));
  sheet.getRange('A1:B1').setFontWeight('bold');
  applyMonthValidation(sheet);

  // 블록 1 — 수입
  sheet.getRange(MV_ROWS.incomeTitle, 1).setValue('■ 수입').setFontWeight('bold');
  sheet.getRange(MV_ROWS.incomeHeader, 1, 1, 5)
    .setValues([['날짜', '유형', '카테고리', '가맹점', '금액(USD)']]).setFontWeight('bold');
  sheet.getRange(MV_ROWS.incomeTitle, 7).setValue('수입 합계').setFontWeight('bold');
  sheet.getRange(MV_ROWS.incomeTitle, 8).setFormula(
    '=SUMPRODUCT(' + txMonth + '*(' + colRange(TX, 'type') + '="income")*' +
    counted + '*' + amountUsd + ')'
  );
  sheet.getRange(MV_ROWS.incomeStart, 1).setFormula(
    '=IFERROR(FILTER({' +
      colRange(TX, 'date') + ',' + colRange(TX, 'type') + ',' +
      colRange(TX, 'category') + ',' + colRange(TX, 'merchant') + ',' + amountUsd +
    '},LEFT(TEXT(' + colRange(TX, 'date') + ',"yyyy-mm-dd"),7)=' + M +
    ',' + colRange(TX, 'type') + '="income",' + colRange(TX, 'status') + '<>"deleted"),"")'
  );

  // 블록 2 — 고정비
  sheet.getRange(MV_ROWS.fixedTitle, 1).setValue('■ 고정비').setFontWeight('bold');
  sheet.getRange(MV_ROWS.fixedHeader, 1, 1, 5)
    .setValues([['항목', '예상(USD)', '실제(USD)', '편차', '상태']]).setFontWeight('bold');
  var fixedFormulas = [];
  for (var k = 0; k < MV_ROWS.fixedCount; k++) {
    var row = MV_ROWS.fixedStart + k;
    var recRow = 2 + k;
    var expected = 'IF(REGEXMATCH(' + colCell(REC, 'amount_rule', recRow) + '&"","^income_pct:"),' +
      '$H$' + MV_ROWS.incomeTitle + '*VALUE(REGEXEXTRACT(' +
      colCell(REC, 'amount_rule', recRow) + ',"[0-9.]+$"))/100,' +
      'IF(' + colCell(REC, 'currency', recRow) + '="KRW",N(' +
      colCell(REC, 'expected_amount', recRow) + ')/' + fxFormula() + ',N(' +
      colCell(REC, 'expected_amount', recRow) + ')))';
    var actual = 'SUMPRODUCT(' + txMonth + '*(' + colRange(TX, 'recurring_id') + '=' +
      colCell(REC, 'id', recRow) + ')*' + counted + '*' + amountUsd + ')';
    var state = 'IFERROR(INDEX(FILTER(' + colRange(TX, 'status') + ',' +
      colRange(TX, 'recurring_id') + '=' + colCell(REC, 'id', recRow) + ',LEFT(TEXT(' +
      colRange(TX, 'date') + ',"yyyy-mm-dd"),7)=' + M + '),1),"미기장")';
    fixedFormulas.push([
      '=IF(' + colCell(REC, 'active', recRow) + '="Y",' + colCell(REC, 'name', recRow) + ',"")',
      '=IF($A' + row + '="","",' + expected + ')',
      '=IF($A' + row + '="","",' + actual + ')',
      '=IF($A' + row + '="","",$C' + row + '-$B' + row + ')',
      '=IF($A' + row + '="","",' + state + ')'
    ]);
  }
  sheet.getRange(MV_ROWS.fixedStart, 1, fixedFormulas.length, 5).setFormulas(fixedFormulas);

  // 블록 3 — 유동비 봉투
  sheet.getRange(MV_ROWS.envTitle, 1).setValue('■ 유동비 봉투').setFontWeight('bold');
  sheet.getRange(MV_ROWS.envHeader, 1, 1, 6)
    .setValues([['봉투', '예산', '실행', '잔액', '남은 일수', '일일 가용액']]).setFontWeight('bold');
  var monthStart = 'DATEVALUE(' + M + '&"-01")';
  var remainingDays = 'IF(TEXT(TODAY(),"yyyy-mm")=' + M +
    ',EOMONTH(TODAY(),0)-TODAY()+1,EOMONTH(' + monthStart + ',0)-' + monthStart + '+1)';
  var envFormulas = [];
  for (var e = 0; e < MV_ROWS.envCount; e++) {
    var erow = MV_ROWS.envStart + e;
    var spent = 'SUMPRODUCT(' + txMonth + '*(' + colRange(TX, 'envelope') + '=$A' + erow + ')*(' +
      colRange(TX, 'type') + '="expense")*(' + colRange(TX, 'kind') + '="variable")*((' +
      colRange(TX, 'status') + '="active")+(' + colRange(TX, 'status') + '="confirmed")+(' +
      colRange(TX, 'status') + '="committed"))*' +
      amountUsd + ')';
    envFormulas.push([
      '=IFERROR(INDEX(FILTER(' + colRange(BUD, 'envelope') + ',' +
        colRange(BUD, 'month') + '=' + M + '),' + (e + 1) + '),"")',
      '=IF($A' + erow + '="","",SUMPRODUCT((' + colRange(BUD, 'month') + '=' + M + ')*(' +
        colRange(BUD, 'envelope') + '=$A' + erow + ')*' + colRange(BUD, 'amount') + '))',
      '=IF($A' + erow + '="","",' + spent + ')',
      '=IF($A' + erow + '="","",$B' + erow + '-$C' + erow + ')',
      '=IF($A' + erow + '="","",' + remainingDays + ')',
      '=IF($A' + erow + '="","",IFERROR($D' + erow + '/$E' + erow + ',0))'
    ]);
  }
  sheet.getRange(MV_ROWS.envStart, 1, envFormulas.length, 6).setFormulas(envFormulas);

  // 블록 4 — 카테고리 비중
  sheet.getRange(MV_ROWS.catTitle, 1).setValue('■ 카테고리 비중').setFontWeight('bold');
  sheet.getRange(MV_ROWS.catHeader, 1, 1, 3)
    .setValues([['카테고리', '합계(USD)', '비중']]).setFontWeight('bold');
  sheet.getRange(MV_ROWS.catStart, 1).setFormula(
    '=IFERROR(SORT(UNIQUE(FILTER(' + colRange(TX, 'category') + ',LEFT(TEXT(' +
    colRange(TX, 'date') + ',"yyyy-mm-dd"),7)=' + M + ',' + colRange(TX, 'type') +
    '="expense",' + colRange(TX, 'status') + '<>"deleted",' + colRange(TX, 'status') + '<>"expected",' +
    colRange(TX, 'category') + '<>""))),"")'
  );
  var catLast = MV_ROWS.catStart + MV_ROWS.catCount - 1;
  var catFormulas = [];
  for (var c = 0; c < MV_ROWS.catCount; c++) {
    var crow = MV_ROWS.catStart + c;
    catFormulas.push([
      '=IF($A' + crow + '="","",SUMPRODUCT(' + txMonth + '*(' + colRange(TX, 'category') +
        '=$A' + crow + ')*(' + colRange(TX, 'type') + '="expense")*' + counted + '*' +
        amountUsd + '))',
      '=IF($A' + crow + '="","",IFERROR($B' + crow + '/SUM($B$' + MV_ROWS.catStart +
        ':$B$' + catLast + '),""))'
    ]);
  }
  sheet.getRange(MV_ROWS.catStart, 2, catFormulas.length, 2).setFormulas(catFormulas);
  sheet.getRange(MV_ROWS.catStart, 3, MV_ROWS.catCount, 1).setNumberFormat('0.0%');

  // 블록 5 — 원장
  sheet.getRange(MV_ROWS.ledgerTitle, 1).setValue('■ 원장').setFontWeight('bold');
  sheet.getRange(MV_ROWS.ledgerHeader, 1, 1, 7)
    .setValues([['날짜', '유형', '카테고리', '가맹점', '금액(USD)', '메모', '출처']])
    .setFontWeight('bold');
  sheet.getRange(MV_ROWS.ledgerStart, 1).setFormula(
    '=IFERROR(SORT(FILTER({' +
      colRange(TX, 'date') + ',' + colRange(TX, 'type') + ',' + colRange(TX, 'category') + ',' +
      colRange(TX, 'merchant') + ',' + amountUsd + ',' + colRange(TX, 'memo') + ',' +
      colRange(TX, 'source') +
    '},LEFT(TEXT(' + colRange(TX, 'date') + ',"yyyy-mm-dd"),7)=' + M + ',' +
    colRange(TX, 'status') + '<>"deleted"),1,FALSE),"")'
  );

  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 8);
  return 'Monthly_View 재생성 완료';
}

/** B1 에 원장에서 유도한 월 목록 드롭다운을 건다. */
function applyMonthValidation(sheet) {
  var months = {};
  readAll(SHEETS.TRANSACTIONS.name).forEach(function (row) {
    var month = toDateStr(row.date).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) {
      months[month] = true;
    }
  });
  months[currentMonthStr()] = true;
  var list = Object.keys(months).sort().reverse();
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(list, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange('B1').setDataValidation(rule);
}

/**
 * Dashboard 탭을 지우고 다시 그린다.
 * 최근 12개월 수입·지출, 부채 잔액, 목표 진행률, 월별 막대 차트.
 */
function buildDashboard() {
  var TX = SHEETS.TRANSACTIONS;
  var DEBTS = SHEETS.DEBTS;
  var ASSETS = SHEETS.ASSETS;
  var GOALS = SHEETS.GOALS;
  var sheet = getSheet(SHEETS.DASHBOARD.name);
  removeCharts(sheet);
  sheet.clear();
  ensureRows(sheet, 60);

  var counted = '((' + colRange(TX, 'status') + '="active")+(' + colRange(TX, 'status') + '="confirmed")+(' + colRange(TX, 'status') + '="committed"))';
  var amountUsd = colRange(TX, 'amount_usd');

  // 최근 12개월 수입·지출 (active/confirmed 만. expected 는 예정이다)
  sheet.getRange('A1').setValue('■ 최근 12개월 수입·지출').setFontWeight('bold');
  sheet.getRange(2, 1, 1, 4).setValues([['월', '수입', '지출', '순저축']]).setFontWeight('bold');
  var monthly = [];
  for (var i = 11; i >= 0; i--) {
    var r = 3 + (11 - i);
    var monthCell = '$A' + r;
    var pred = '(LEFT(TEXT(' + colRange(TX, 'date') + ',"yyyy-mm-dd"),7)=' + monthCell + ')';
    monthly.push([
      '=TEXT(EOMONTH(TODAY(),-' + i + '),"yyyy-mm")',
      '=SUMPRODUCT(' + pred + '*(' + colRange(TX, 'type') + '="income")*' + counted +
        '*' + amountUsd + ')',
      '=SUMPRODUCT(' + pred + '*(' + colRange(TX, 'type') + '="expense")*' + counted +
        '*' + amountUsd + ')',
      '=$B' + r + '-$C' + r
    ]);
  }
  sheet.getRange(3, 1, monthly.length, 4).setFormulas(monthly);

  // 부채
  sheet.getRange('F1').setValue('■ 부채').setFontWeight('bold');
  sheet.getRange(2, 6, 1, 5)
    .setValues([['이름', '원금', '이율(%)', '월 상환', '남은 회차']]).setFontWeight('bold');
  sheet.getRange(3, 6).setFormula(
    '=IFERROR(FILTER({' +
      colRange(DEBTS, 'name') + ',' + colRange(DEBTS, 'principal') + ',' +
      colRange(DEBTS, 'rate_pct') + ',' + colRange(DEBTS, 'monthly_payment') + ',' +
      colRange(DEBTS, 'remaining_count') +
    '},' + colRange(DEBTS, 'name') + '<>""),"")'
  );
  sheet.getRange('F16').setValue('부채 합계').setFontWeight('bold');
  sheet.getRange('G16').setFormula('=SUM(' + colRange(DEBTS, 'principal') + ')');

  // 목표 진행률 — 현재 자산은 Assets 최신 스냅샷 합계(USD 환산)
  var latestAssets = 'SUMPRODUCT((' + colRange(ASSETS, 'snapshot_date') + '=MAX(' +
    colRange(ASSETS, 'snapshot_date') + '))*IF(' + colRange(ASSETS, 'currency') +
    '="KRW",' + colRange(ASSETS, 'balance') + '/' + fxFormula() + ',' +
    colRange(ASSETS, 'balance') + '))';
  sheet.getRange('A18').setValue('■ 목표 진행률').setFontWeight('bold');
  sheet.getRange('C18').setValue('현재 자산(USD)').setFontWeight('bold');
  sheet.getRange('D18').setFormula('=IFERROR(' + latestAssets + ',0)');
  sheet.getRange(19, 1, 1, 4)
    .setValues([['목표', '기간', '목표액', '진행률']]).setFontWeight('bold');
  var goalFormulas = [];
  for (var g = 0; g < 10; g++) {
    var grow = 20 + g;
    var goalRow = 2 + g;
    goalFormulas.push([
      '=IF(' + colCell(GOALS, 'title', goalRow) + '="","",' + colCell(GOALS, 'title', goalRow) + ')',
      '=IF($A' + grow + '="","",' + colCell(GOALS, 'horizon', goalRow) + ')',
      '=IF($A' + grow + '="","",' + colCell(GOALS, 'target_amount', goalRow) + ')',
      '=IF($A' + grow + '="","",IFERROR($D$18/$C' + grow + ',""))'
    ]);
  }
  sheet.getRange(20, 1, goalFormulas.length, 4).setFormulas(goalFormulas);
  sheet.getRange(20, 4, goalFormulas.length, 1).setNumberFormat('0.0%');

  // 월별 수입·지출 막대 차트
  var chart = sheet.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(sheet.getRange(2, 1, 13, 3))
    .setNumHeaders(1)
    .setPosition(2, 12, 0, 0)
    .setOption('title', '최근 12개월 수입·지출')
    .setOption('legend', { position: 'bottom' })
    .build();
  sheet.insertChart(chart);

  sheet.autoResizeColumns(1, 10);
  return 'Dashboard 재생성 완료';
}
