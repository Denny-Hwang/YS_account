/**
 * Receipt.js — 영수증 사진을 받아 글자를 읽고 금액 후보를 찾는다.
 *
 * 경계 (CLAUDE.md Golden Rule 2)
 * - OCR 은 글자만 뽑는다. 금액·날짜 추출은 그 글자에 규칙 기반 파서를 돌려서 한다.
 * - 사진에서 읽은 값은 언제나 confidence low 다. 사용자가 버튼으로 확인해야 기록된다.
 *
 * Drive 고급 서비스(v2)가 필요하다. appsscript.json 의 enabledAdvancedServices 참고.
 */

/** 영수증 원본을 모아 둘 Drive 폴더 이름. */
var RECEIPT_FOLDER = 'family-budget-receipts';

/** OCR 결과 텍스트에서 총액일 가능성이 높은 줄을 찾을 때 보는 낱말. */
var TOTAL_HINTS = ['합계', '총액', '결제금액', '청구금액', 'total', 'amount due', 'balance due', 'grand total'];

/** 영수증 폴더를 가져오거나 만든다. */
function receiptFolder() {
  var found = DriveApp.getFoldersByName(RECEIPT_FOLDER);
  return found.hasNext() ? found.next() : DriveApp.createFolder(RECEIPT_FOLDER);
}

/**
 * Telegram 이 보관 중인 파일을 내려받는다.
 * @param {string} fileId Telegram file_id
 * @return {?Blob}
 */
function downloadTelegramFile(fileId) {
  var info = tg('getFile', { file_id: fileId });
  var path = info && info.result && info.result.file_path;
  if (!path) {
    return null;
  }
  try {
    // 파일 다운로드는 /file/bot<token>/<path> 경로라 tg() 를 쓸 수 없다.
    var url = 'https://api.telegram.org/file/bot' + getSecret('BOT_TOKEN') + '/' + path;
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return response.getResponseCode() === 200 ? response.getBlob() : null;
  } catch (err) {
    logEvent('', 'receipt', '', '파일 다운로드 실패: ' + err);
    return null;
  }
}

/**
 * 이미지에서 글자를 읽는다. Drive 가 OCR 로 임시 문서를 만들고, 읽은 뒤 휴지통으로 보낸다.
 * @param {!Blob} blob
 * @return {string} 읽은 글자. 실패하면 빈 문자열.
 */
function ocrImage(blob) {
  var temp = null;
  try {
    temp = Drive.Files.insert(
      { title: 'ocr-' + nowIso(), mimeType: 'application/vnd.google-apps.document' },
      blob,
      { ocr: true, ocrLanguage: getConfig('ocr_language', 'ko') }
    );
    return DocumentApp.openById(temp.id).getBody().getText();
  } catch (err) {
    logEvent('', 'receipt', '', 'OCR 실패: ' + err);
    return '';
  } finally {
    if (temp && temp.id) {
      try {
        DriveApp.getFileById(temp.id).setTrashed(true);
      } catch (ignored) {
        Logger.log('OCR 임시 문서 정리 실패: ' + temp.id);
      }
    }
  }
}

/**
 * OCR 텍스트에서 총액으로 보이는 줄을 고른다.
 * 합계 낱말이 있는 줄을 먼저 보고, 없으면 금액이 가장 큰 줄을 본다.
 * 금액 해석 자체는 규칙 기반 parseMessage 가 한다.
 * @param {string} text
 * @param {!Object} ctx parseMessage 컨텍스트
 * @return {?Object} parseMessage 결과. 못 찾으면 null.
 */
function pickReceiptTotal(text, ctx) {
  var lines = String(text || '')
    .split('\n')
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line && /\d/.test(line); });

  var hinted = lines.filter(function (line) {
    var lower = line.toLowerCase();
    return TOTAL_HINTS.some(function (hint) { return lower.indexOf(hint) >= 0; });
  });

  var pool = hinted.length ? hinted : lines;
  var best = null;
  pool.forEach(function (line) {
    var parsed = parseMessage(line, ctx);
    if (!parsed || parsed.intent !== 'record' || parsed.amount === null) {
      return;
    }
    if (!best || Number(parsed.amount_usd) > Number(best.amount_usd)) {
      best = parsed;
    }
  });
  return best;
}

/**
 * 영수증 사진 메시지를 처리한다.
 * 사진을 Drive 에 남기고, 읽은 금액을 확인 버튼과 함께 되돌려 준다.
 * @param {string|number} chatId
 * @param {string|number} userId
 * @param {!Object} message Telegram message (photo 또는 document)
 * @param {number} logRow
 */
function handleReceipt(chatId, userId, message, logRow) {
  var photos = message.photo || [];
  var fileId = photos.length
    ? photos[photos.length - 1].file_id // 가장 큰 해상도
    : (message.document && message.document.file_id);
  if (!fileId) {
    return;
  }

  safeSend(chatId, '영수증을 읽는 중입니다...');
  var blob = downloadTelegramFile(fileId);
  if (!blob) {
    safeSend(chatId, '사진을 가져오지 못했습니다. 다시 보내 주세요.');
    updateLogResult(logRow, '', '영수증 다운로드 실패');
    return;
  }

  var saved = null;
  try {
    saved = receiptFolder().createFile(blob.setName('receipt-' + nowIso() + '.jpg'));
  } catch (err) {
    logEvent(userId, 'receipt', '', 'Drive 저장 실패: ' + err);
  }

  var text = ocrImage(blob);
  if (!text) {
    safeSend(chatId, '글자를 읽지 못했습니다. 금액을 직접 보내 주세요. 예) 코스트코 85.89');
    updateLogResult(logRow, '', 'OCR 결과 없음');
    return;
  }

  var ctx = buildParseContext();
  var parsed = pickReceiptTotal(text, ctx);
  if (!parsed) {
    safeSend(chatId, '금액을 찾지 못했습니다. 직접 보내 주세요. 예) 코스트코 85.89');
    updateLogResult(logRow, '', '영수증 금액 없음');
    return;
  }

  // 사진에서 읽은 값은 언제나 확인이 필요하다.
  parsed.confidence = 'low';
  parsed.memo = saved ? '영수증 ' + saved.getUrl() : '영수증';
  if (!parsed.merchantText) {
    parsed.merchantText = '';
    parsed.merchantTextRaw = '';
  }

  // 대기 키는 Log 행 번호다. 캐시가 만료돼도 Log 의 parsed_json 에서 복구된다.
  updateLogResult(logRow, JSON.stringify(parsed), '영수증 분류 대기');
  putPending(logRow, parsed);
  safeSend(
    chatId,
    '영수증에서 ' + formatUsd(parsed.amount_usd) + ' 를 읽었습니다. 분류를 골라 주세요.\n' +
      '금액이 다르면 직접 보내 주세요.',
    buildIndexKeyboard('cls', logRow, canonicalChoices())
  );
}
