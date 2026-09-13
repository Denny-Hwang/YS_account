/**
 * Telegram.js — Telegram Bot API 호출. GAS 전용.
 * BOT_TOKEN 은 tg() 한 곳에서만 읽는다. 다른 함수는 반드시 tg() 를 거친다.
 */

/**
 * Telegram Bot API 를 호출한다. 실패해도 예외를 던지지 않고 Log 탭에 남긴다.
 * @param {string} method Bot API 메서드명
 * @param {!Object} payload JSON 본문
 * @return {?Object} 응답 JSON. 실패 시 null.
 */
function tg(method, payload) {
  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  };
  var response;
  try {
    // BOT_TOKEN 미설정도 여기서 잡는다. Telegram 호출은 어떤 경우에도 throw 하지 않는다.
    var url = 'https://api.telegram.org/bot' + getSecret('BOT_TOKEN') + '/' + method;
    response = UrlFetchApp.fetch(url, options);
  } catch (err) {
    logEvent('', 'tg:' + method, JSON.stringify(payload || {}), 'fetch 실패: ' + err);
    return null;
  }
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code !== 200) {
    logEvent('', 'tg:' + method, JSON.stringify(payload || {}), 'HTTP ' + code + ' ' + body);
    return null;
  }
  var json;
  try {
    json = JSON.parse(body);
  } catch (err2) {
    logEvent('', 'tg:' + method, body, 'JSON 파싱 실패: ' + err2);
    return null;
  }
  if (!json.ok) {
    logEvent('', 'tg:' + method, JSON.stringify(payload || {}), 'API 오류: ' + body);
    return null;
  }
  return json;
}

/**
 * 메시지를 보낸다.
 * @param {string|number} chatId
 * @param {string} text
 * @param {Object=} replyMarkup inline_keyboard 등
 * @return {?Object}
 */
function sendMessage(chatId, text, replyMarkup) {
  var payload = { chat_id: chatId, text: text, disable_web_page_preview: true };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  return tg('sendMessage', payload);
}

/**
 * 기존 메시지를 수정한다.
 * @param {string|number} chatId
 * @param {string|number} messageId
 * @param {string} text
 * @param {Object=} replyMarkup
 * @return {?Object}
 */
function editMessageText(chatId, messageId, text, replyMarkup) {
  var payload = {
    chat_id: chatId,
    message_id: messageId,
    text: text,
    disable_web_page_preview: true
  };
  payload.reply_markup = replyMarkup || { inline_keyboard: [] };
  return tg('editMessageText', payload);
}

/**
 * 콜백 버튼 응답. 누르면 도는 로딩 표시를 멈춘다.
 * @param {string} callbackQueryId
 * @param {string=} text
 * @return {?Object}
 */
function answerCallbackQuery(callbackQueryId, text) {
  var payload = { callback_query_id: callbackQueryId };
  if (text) {
    payload.text = text;
  }
  return tg('answerCallbackQuery', payload);
}

/**
 * 웹훅을 등록한다.
 * Apps Script 의 doPost 는 요청 헤더를 읽을 수 없으므로 secret 은 URL 파라미터로만 전달한다.
 * 배포 URL 은 Script Properties 의 WEBAPP_URL 에서 읽는다.
 * @return {?Object}
 */
function setWebhook() {
  var base = getSecret('WEBAPP_URL');
  var secret = getSecret('WEBHOOK_SECRET');
  var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(secret);
  var res = tg('setWebhook', {
    url: url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
  Logger.log(res ? '웹훅 등록 완료' : '웹훅 등록 실패. Log 탭을 확인하세요.');
  return res;
}

/** 웹훅을 해제한다. */
function deleteWebhook() {
  var res = tg('deleteWebhook', { drop_pending_updates: true });
  Logger.log(res ? '웹훅 해제 완료' : '웹훅 해제 실패. Log 탭을 확인하세요.');
  return res;
}

/**
 * 현재 웹훅 상태를 조회해 실행 로그에 출력한다.
 * 회신이 여러 번 오거나 아예 오지 않을 때 last_error_message 와
 * pending_update_count 를 보면 원인을 알 수 있다.
 * @return {?Object}
 */
function getWebhookInfo() {
  var res = tg('getWebhookInfo');
  Logger.log(res ? JSON.stringify(res.result, null, 2) : '웹훅 정보 조회 실패. Log 탭을 확인하세요.');
  return res;
}

/**
 * 선택지 키보드. callback_data 는 라벨이 아니라 `prefix|key|index` 다.
 * Telegram 의 callback_data 는 64바이트가 한도라 한글 라벨을 그대로 넣으면 넘칠 수 있다.
 * @param {string} prefix 'cls' | 'amt'
 * @param {(string|number)} key 대기 항목 키(Log 행 번호)
 * @param {!Array<string>} labels 표준 순서의 라벨. index 는 이 배열 기준이다
 * @param {Array<number>=} order 표시 순서(index 배열). 생략하면 labels 순서
 * @param {number=} perRow 한 줄에 몇 개. 기본 2
 * @return {!Object}
 */
function buildIndexKeyboard(prefix, key, labels, order, perRow) {
  var seq = order && order.length ? order : labels.map(function (_l, i) { return i; });
  var width = perRow || 2;
  var rows = [];
  for (var i = 0; i < seq.length; i += width) {
    var row = [];
    for (var j = i; j < Math.min(i + width, seq.length); j++) {
      var idx = seq[j];
      row.push({ text: labels[idx], callback_data: prefix + '|' + key + '|' + idx });
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

/** 삭제 버튼 하나짜리 키보드. */
function buildDeleteKeyboard(txId) {
  return { inline_keyboard: [[{ text: '삭제', callback_data: 'del|' + txId }]] };
}

/**
 * 봉투 간 예산 이동 버튼. `mv|fromIndex|toIndex|amount` (index 는 Config.envelopes 기준).
 * @param {number} fromIdx
 * @param {number} toIdx
 * @param {number} amount USD 정수
 * @param {string} label 버튼 글자
 * @return {!Object}
 */
function buildMoveKeyboard(fromIdx, toIdx, amount, label) {
  return { inline_keyboard: [[{ text: label, callback_data: 'mv|' + fromIdx + '|' + toIdx + '|' + amount }]] };
}
