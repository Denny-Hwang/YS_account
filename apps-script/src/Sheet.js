/**
 * Sheet.js — 시트 공통 헬퍼. 모든 탭 접근은 이 파일을 거친다.
 * 원장은 append-only + soft delete 이므로 행을 물리 삭제하는 헬퍼는 제공하지 않는다.
 */

/**
 * 탭을 가져온다. 없으면 throw.
 * @param {string} name
 * @return {!Sheet}
 */
function getSheet(name) {
  var sheet = getSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('탭 "' + name + '" 이 없습니다. runSetupAll() 을 먼저 실행하세요.');
  }
  return sheet;
}

/** 탭의 헤더 배열을 읽는다. */
function readHeaders(name) {
  var sheet = getSheet(name);
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    return [];
  }
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim();
  });
}

/**
 * 탭 전체를 헤더 키 객체 배열로 읽는다.
 * @param {string} name
 * @return {!Array<!Object>} 각 객체에 _row(시트 행 번호)를 함께 넣는다.
 */
function readAll(name) {
  var sheet = getSheet(name);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) {
    return [];
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) {
    return String(h).trim();
  });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 };
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) {
        continue;
      }
      var v = values[i][c];
      obj[headers[c]] = v === null || v === undefined ? '' : v;
      if (String(v).trim() !== '') {
        empty = false;
      }
    }
    if (!empty) {
      rows.push(obj);
    }
  }
  return rows;
}

/**
 * 객체를 헤더 순서로 정렬해 한 행 추가한다.
 * @param {string} name
 * @param {!Object} obj
 * @return {number} 추가된 행 번호
 */
function appendRow(name, obj) {
  var sheet = getSheet(name);
  var headers = readHeaders(name);
  var row = headers.map(function (h) {
    var v = obj[h];
    return v === null || v === undefined ? '' : v;
  });
  sheet.appendRow(row);
  // 추가 직후 같은 실행 안에서 다시 읽는 경로가 있어 보류 중인 쓰기를 확정한다.
  SpreadsheetApp.flush();
  return sheet.getLastRow();
}

/**
 * id 열 값으로 행 번호를 찾는다.
 * @param {string} name
 * @param {string} id
 * @param {string=} idColumn 기본 'id'
 * @return {number} 행 번호. 없으면 -1.
 */
function findRowById(name, id, idColumn) {
  var col = idColumn || 'id';
  var headers = readHeaders(name);
  var idx = headers.indexOf(col);
  if (idx < 0) {
    throw new Error('탭 "' + name + '" 에 "' + col + '" 열이 없습니다.');
  }
  var sheet = getSheet(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return -1;
  }
  var values = sheet.getRange(2, idx + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === String(id).trim()) {
      return i + 2;
    }
  }
  return -1;
}

/**
 * id 로 행을 찾아 patch 의 열만 갱신한다. updated_at 은 자동으로 채운다.
 * 행을 삭제하지 않는다(Golden Rule 3).
 * @param {string} name
 * @param {string} id
 * @param {!Object} patch
 * @return {number} 갱신된 행 번호. 없으면 -1.
 */
function updateRowById(name, id, patch) {
  var rowNum = findRowById(name, id);
  if (rowNum < 0) {
    return -1;
  }
  var headers = readHeaders(name);
  var sheet = getSheet(name);
  var merged = {};
  Object.keys(patch).forEach(function (k) {
    merged[k] = patch[k];
  });
  if (headers.indexOf('updated_at') >= 0 && merged.updated_at === undefined) {
    merged.updated_at = nowIso();
  }
  Object.keys(merged).forEach(function (key) {
    var idx = headers.indexOf(key);
    if (idx < 0) {
      return;
    }
    var v = merged[key];
    sheet.getRange(rowNum, idx + 1).setValue(v === null || v === undefined ? '' : v);
  });
  return rowNum;
}

/**
 * id 로 행을 찾아 갱신하고, 없으면 추가한다.
 * row 에 없는 열은 건드리지 않는다. 그래서 사용자가 시트에서 고친 값(예: active)을 지키고 싶으면
 * 그 키를 row 에서 빼면 된다.
 * @param {string} name
 * @param {!Object} row id 를 포함한 객체
 * @return {string} 'added' | 'updated'
 */
function upsertRowById(name, row) {
  var id = row.id;
  if (id === null || id === undefined || String(id).trim() === '') {
    throw new Error('upsertRowById: id 가 없습니다. 탭=' + name);
  }
  if (findRowById(name, id) < 0) {
    appendRow(name, row);
    return 'added';
  }
  var patch = {};
  Object.keys(row).forEach(function (key) {
    if (key !== '_row' && key !== 'id') {
      patch[key] = row[key];
    }
  });
  updateRowById(name, id, patch);
  return 'updated';
}

/**
 * 새 id 를 만든다.
 * @param {string} prefix
 * @return {string}
 */
function newId(prefix) {
  return prefix + '_' + Utilities.getUuid().slice(0, 8);
}

/** 현재 시각 ISO 8601 문자열. */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Config.timezone 기준 오늘 날짜 YYYY-MM-DD.
 * @return {string}
 */
function todayStr() {
  var tz = getConfig('timezone', 'America/Los_Angeles');
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

/** Config.timezone 기준 이번 달 YYYY-MM. */
function currentMonthStr() {
  return todayStr().slice(0, 7);
}

/** 값이 Date 든 문자열이든 YYYY-MM-DD 로 정규화한다. */
function toDateStr(value) {
  if (value instanceof Date) {
    var tz = getConfig('timezone', 'America/Los_Angeles');
    return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  }
  var s = String(value || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[0] : s;
}
