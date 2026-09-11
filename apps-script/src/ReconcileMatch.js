/**
 * ReconcileMatch.js — 순수 모듈. 카드·은행 CSV 와 원장을 대조한다.
 * Google 서비스에 의존하지 않는다. 파일 읽기는 Reconcile.js 가 한다.
 *
 * GAS 전역 충돌을 피하려고 내부 헬퍼에는 rec 접두사를 쓴다.
 */

/** 소수 둘째 자리 반올림. */
function recRound(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * CSV 텍스트를 행 배열로 바꾼다. 따옴표 안의 콤마와 줄바꿈, "" 이스케이프를 처리한다.
 * @param {string} text
 * @return {!Array<!Array<string>>}
 */
function parseCsv(text) {
  var s = String(text === null || text === undefined ? '' : text);
  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  var i = 0;

  while (i < s.length) {
    var ch = s.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (s.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  row.push(field);
  rows.push(row);

  // 완전히 빈 줄은 버린다.
  return rows.filter(function (r) {
    return r.some(function (cell) { return String(cell).trim() !== ''; });
  });
}

/**
 * CSV 를 헤더 키 객체 배열로 바꾼다.
 * @param {string} text
 * @return {{headers: !Array<string>, rows: !Array<!Object>}}
 */
function csvToObjects(text) {
  var rows = parseCsv(text);
  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }
  var headers = rows[0].map(function (h) { return String(h).trim(); });
  var out = rows.slice(1).map(function (cells, i) {
    var obj = { _line: i + 2 };
    headers.forEach(function (h, c) {
      if (h) {
        obj[h] = cells[c] === undefined ? '' : String(cells[c]).trim();
      }
    });
    return obj;
  });
  return { headers: headers, rows: out };
}

/** 두 날짜 문자열의 차이(일). 형식이 아니면 null. */
function recDayDiff(a, b) {
  var pa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a || '').trim());
  var pb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(b || '').trim());
  if (!pa || !pb) {
    return null;
  }
  var ta = Date.UTC(Number(pa[1]), Number(pa[2]) - 1, Number(pa[3]));
  var tb = Date.UTC(Number(pb[1]), Number(pb[2]) - 1, Number(pb[3]));
  return Math.round((ta - tb) / 86400000);
}

/**
 * 명세서 행과 원장 행을 맞춰 본다.
 *
 * 금액이 (허용 오차 안에서) 같고 날짜가 windowDays 안이면 한 쌍으로 본다.
 * 원장 행 하나는 명세서 행 하나에만 쓰인다. 날짜가 가까운 쪽을 먼저 가져간다.
 *
 * @param {!Array<{date: string, amount: number, description: string}>} statement
 * @param {!Array<!Object>} ledger 원장 행. date, amount_usd, merchant, status 를 본다.
 * @param {{windowDays: number, tolerance: number}=} options
 * @return {{matched: !Array<!Object>, missingInLedger: !Array<!Object>, ledgerOnly: !Array<!Object>}}
 */
function reconcile(statement, ledger, options) {
  var windowDays = options && options.windowDays !== undefined ? options.windowDays : 3;
  var tolerance = options && options.tolerance !== undefined ? options.tolerance : 0.01;

  var candidates = (ledger || []).filter(function (row) {
    return String(row.status).trim() !== 'deleted' && String(row.type).trim() !== 'income';
  });
  var used = {};
  var matched = [];
  var missingInLedger = [];

  (statement || []).forEach(function (entry) {
    var best = null;
    var bestGap = null;
    candidates.forEach(function (row, index) {
      if (used[index]) {
        return;
      }
      var amount = Number(row.amount_usd) || 0;
      if (Math.abs(amount - Number(entry.amount)) > tolerance) {
        return;
      }
      var gap = recDayDiff(entry.date, String(row.date).slice(0, 10));
      if (gap === null || Math.abs(gap) > windowDays) {
        return;
      }
      if (bestGap === null || Math.abs(gap) < Math.abs(bestGap)) {
        best = index;
        bestGap = gap;
      }
    });

    if (best === null) {
      missingInLedger.push(entry);
      return;
    }
    used[best] = true;
    matched.push({
      statement: entry,
      ledger: candidates[best],
      dayGap: bestGap
    });
  });

  var ledgerOnly = candidates.filter(function (_row, index) {
    return !used[index];
  });

  return {
    matched: matched,
    missingInLedger: missingInLedger,
    ledgerOnly: ledgerOnly
  };
}

/** 대조 결과를 한국어 요약 문자열로 만든다. */
function formatReconcileReport(result, limit) {
  var cap = limit || 15;
  var lines = [
    '대조 결과: 일치 ' + result.matched.length +
      ' / 원장에 없음 ' + result.missingInLedger.length +
      ' / 명세서에 없음 ' + result.ledgerOnly.length
  ];
  if (result.missingInLedger.length) {
    lines.push('');
    lines.push('원장에 없는 명세서 항목');
    result.missingInLedger.slice(0, cap).forEach(function (entry) {
      lines.push('· ' + entry.date + ' ' + entry.description + ' ' + recRound(entry.amount));
    });
    if (result.missingInLedger.length > cap) {
      lines.push('· 외 ' + (result.missingInLedger.length - cap) + '건');
    }
  }
  if (result.ledgerOnly.length) {
    lines.push('');
    lines.push('명세서에 없는 원장 항목');
    result.ledgerOnly.slice(0, cap).forEach(function (row) {
      lines.push('· ' + String(row.date).slice(0, 10) + ' ' + row.merchant + ' ' +
        recRound(row.amount_usd));
    });
    if (result.ledgerOnly.length > cap) {
      lines.push('· 외 ' + (result.ledgerOnly.length - cap) + '건');
    }
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = {
    parseCsv: parseCsv,
    csvToObjects: csvToObjects,
    reconcile: reconcile,
    formatReconcileReport: formatReconcileReport
  };
}
