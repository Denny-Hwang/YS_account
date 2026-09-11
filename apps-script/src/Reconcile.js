/**
 * Reconcile.js — 카드·은행 CSV 를 원장과 대조한다.
 *
 * 쓰는 순서
 *   1) 명세서 CSV 를 Drive 의 family-budget-statements 폴더에 올린다
 *   2) RECONCILE_MAP 의 열 이름을 명세서에 맞춘다
 *   3) reconcileLatest() 를 실행한다. 결과는 실행 로그와 Log 탭에 남는다
 *
 * 이 파일은 원장을 고치지 않는다. 무엇이 어긋났는지 보고만 한다.
 */

/** 명세서 CSV 를 올려 둘 Drive 폴더 이름. */
var STATEMENT_FOLDER = 'family-budget-statements';

/** 명세서 열 이름. 카드사마다 다르므로 실행 전에 맞춘다. */
var RECONCILE_MAP = {
  date: 'Transaction Date',
  description: 'Description',
  amount: 'Amount',
  /** 명세서가 지출을 음수로 적으면 true. 양수로 적으면 false. */
  expenseIsNegative: true,
  /** 날짜 차이를 며칠까지 같은 건으로 볼지. */
  windowDays: 3
};

/** 명세서 폴더를 가져오거나 만든다. */
function statementFolder() {
  var found = DriveApp.getFoldersByName(STATEMENT_FOLDER);
  return found.hasNext() ? found.next() : DriveApp.createFolder(STATEMENT_FOLDER);
}

/** 폴더에서 가장 최근에 올라온 CSV 파일. */
function latestStatementFile() {
  var files = statementFolder().getFiles();
  var newest = null;
  while (files.hasNext()) {
    var file = files.next();
    if (!/\.csv$/i.test(file.getName())) {
      continue;
    }
    if (!newest || file.getDateCreated() > newest.getDateCreated()) {
      newest = file;
    }
  }
  return newest;
}

/** 명세서 행 하나를 {date, amount, description} 으로 바꾼다. 못 읽으면 null. */
function statementEntry(row) {
  var rawDate = String(row[RECONCILE_MAP.date] || '').trim();
  var date = normalizeLegacyDate(rawDate, '');
  if (!date) {
    return null;
  }
  var raw = String(row[RECONCILE_MAP.amount] || '').trim();
  var info = normalizeLegacyAmount(raw, getConfig('default_currency', 'USD'));
  if (!info) {
    return null;
  }
  // 지출만 대조한다. 부호 규칙은 카드사마다 다르다.
  var isExpense = RECONCILE_MAP.expenseIsNegative ? info.negative : !info.negative;
  if (!isExpense) {
    return null;
  }
  var fx = getConfigNumber('fx_usd_krw', 1332);
  var amountUsd = info.currency === 'KRW' && fx > 0 ? info.amount / fx : info.amount;
  return {
    date: date,
    amount: Math.round(amountUsd * 100) / 100,
    description: String(row[RECONCILE_MAP.description] || '').trim()
  };
}

/**
 * CSV 텍스트를 원장과 대조하고 보고서를 만든다.
 * @param {string} csvText
 * @param {string=} month 'YYYY-MM'. 생략하면 명세서에 나온 달을 모두 본다.
 * @return {string}
 */
function reconcileCsv(csvText, month) {
  var parsed = csvToObjects(csvText);
  if (parsed.rows.length === 0) {
    return 'CSV 에 행이 없습니다.';
  }
  var missingColumns = ['date', 'description', 'amount'].filter(function (key) {
    return parsed.headers.indexOf(RECONCILE_MAP[key]) < 0;
  });
  if (missingColumns.length) {
    return 'RECONCILE_MAP 의 열 이름이 명세서와 다릅니다.\n명세서 헤더: ' +
      parsed.headers.join(' | ') + '\n찾지 못한 항목: ' + missingColumns.join(', ');
  }

  var entries = [];
  var unreadable = 0;
  parsed.rows.forEach(function (row) {
    var entry = statementEntry(row);
    if (entry) {
      entries.push(entry);
    } else {
      unreadable++;
    }
  });
  if (entries.length === 0) {
    return '읽을 수 있는 지출 행이 없습니다. RECONCILE_MAP.expenseIsNegative 를 확인하세요.';
  }

  var months = {};
  entries.forEach(function (entry) { months[entry.date.slice(0, 7)] = true; });
  var target = month ? [month] : Object.keys(months).sort();
  var ledger = [];
  target.forEach(function (m) {
    ledger = ledger.concat(monthTransactions(m));
  });

  var result = reconcile(entries, ledger, { windowDays: RECONCILE_MAP.windowDays });
  var report = formatReconcileReport(result);
  if (unreadable) {
    report += '\n\n읽지 못한 명세서 행 ' + unreadable + '건(헤더·합계 줄 등)';
  }
  Logger.log(report);
  logEvent('', 'reconcile', '', report.slice(0, 5000));
  return report;
}

/** Drive 의 가장 최근 CSV 로 대조를 돌린다. */
function reconcileLatest() {
  var file = latestStatementFile();
  if (!file) {
    var msg = STATEMENT_FOLDER + ' 폴더에 CSV 가 없습니다.';
    Logger.log(msg);
    return msg;
  }
  Logger.log('명세서: ' + file.getName());
  return reconcileCsv(file.getBlob().getDataAsString('UTF-8'));
}
