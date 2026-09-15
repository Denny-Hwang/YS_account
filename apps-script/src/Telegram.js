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
  var res = registerWebhook(true);
  Logger.log(res ? '웹훅 등록 완료(밀린 건 비움)' : '웹훅 등록 실패. Log 탭을 확인하세요.');
  return res;
}

/**
 * 웹훅을 등록한다. 밀린 건을 버릴지 고를 수 있다.
 * 복구 작업은 이미 처리한 것만 확인(ack)하고 나머지는 남겨야 하므로 false 로 부른다.
 * @param {boolean} dropPending 밀린 업데이트를 버릴지
 * @return {?Object}
 */
function registerWebhook(dropPending) {
  var base = getSecret('WEBAPP_URL');
  var secret = getSecret('WEBHOOK_SECRET');
  var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(secret);
  return tg('setWebhook', {
    url: url,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: dropPending === true
  });
}

/**
 * 밀린 업데이트를 가져온다. 웹훅이 걸려 있는 동안에는 쓸 수 없으므로
 * 반드시 deleteWebhook 뒤에만 부른다.
 * @param {?number} offset 이 값 이상만 받는다. null 이면 처음부터
 * @param {number=} limit 한 번에 받을 수, 기본 100
 * @return {!Array<!Object>}
 */
function getUpdates(offset, limit) {
  var payload = { timeout: 0, limit: limit || 100 };
  if (offset !== null && offset !== undefined) {
    payload.offset = offset;
  }
  var res = tg('getUpdates', payload);
  return res && res.result ? res.result : [];
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

/** 없으면 throw 하지 않고 null 을 주는 Script Property 조회. 진단 전용. */
function optionalSecret(key) {
  try {
    return getSecret(key);
  } catch (err) {
    return null;
  }
}

/** 값의 존재만 알리고 내용은 가린다. 진단 결과를 그대로 복사해도 비밀값이 새지 않게 한다. */
function maskSecret(value) {
  if (!value) {
    return '없음 ← Script Properties 에 설정하세요';
  }
  return '설정됨 (' + String(value).length + '자, 끝 4자리 …' + String(value).slice(-4) + ')';
}

/**
 * 웹훅이 동작하지 않을 때 원인을 한 번에 좁히는 진단.
 * 실행 로그에 결과를 찍는다. 비밀값은 가려서 출력하므로 결과를 그대로 복사해도 된다.
 *
 * 읽는 법:
 *   - `pending_update_count` 가 계속 0 이 아니면 Telegram 이 배달에 실패하고 있다.
 *   - `last_error_message` 가 있으면 그 문장이 원인이다.
 *   - 등록된 웹훅 URL 이 지금 배포 URL 과 다르면 예전 배포로 가고 있다. setWebhook 을 다시 실행한다.
 *   - Log 꼬리에 `거부:` 가 보이면 token 또는 allowed_telegram_ids 문제다.
 *   - Log 꼬리에 아무 흔적이 없으면 요청 자체가 이 스크립트에 닿지 않은 것이다.
 *
 * @return {?Object} getWebhookInfo 응답
 */
function diagnoseWebhook() {
  var lines = ['── 웹훅 진단 ──'];

  var botToken = optionalSecret('BOT_TOKEN');
  var secret = optionalSecret('WEBHOOK_SECRET');
  var webappUrl = optionalSecret('WEBAPP_URL');
  lines.push('BOT_TOKEN: ' + maskSecret(botToken));
  lines.push('WEBHOOK_SECRET: ' + maskSecret(secret));

  if (!webappUrl) {
    lines.push('WEBAPP_URL: 없음 ← 배포 URL 을 Script Properties 에 넣으세요');
  } else {
    lines.push('WEBAPP_URL: ' + summarizeExecUrl(webappUrl));
    if (!/\/exec$/.test(String(webappUrl).split('?')[0])) {
      lines.push('  ⚠ /exec 로 끝나지 않습니다. /dev 주소는 본인만 열 수 있어 웹훅으로 쓸 수 없습니다.');
    }
  }

  var me = tg('getMe');
  lines.push('getMe: ' + (me ? '@' + me.result.username : '실패 ← BOT_TOKEN 을 확인하세요'));

  var info = tg('getWebhookInfo');
  if (!info) {
    lines.push('getWebhookInfo: 실패 ← BOT_TOKEN 을 확인하세요');
  } else {
    var r = info.result || {};
    lines.push('등록된 웹훅: ' + (r.url ? summarizeExecUrl(r.url) : '없음 ← setWebhook 을 실행하세요'));
    lines.push('밀린 업데이트: ' + (r.pending_update_count || 0) + '건');
    lines.push('마지막 오류: ' + (r.last_error_message || '없음') +
      (r.last_error_date ? ' (' + new Date(r.last_error_date * 1000).toISOString() + ')' : ''));
    if (r.url && webappUrl) {
      var sameBase = r.url.split('?')[0] === String(webappUrl).split('?')[0];
      lines.push('배포 URL 일치: ' + (sameBase ? '예' : '아니오 ← setWebhook 을 다시 실행하세요'));
    }
    if (r.url && secret) {
      var m = /[?&]token=([^&]*)/.exec(r.url);
      var sentToken = m ? decodeURIComponent(m[1]) : '';
      lines.push('token 일치: ' + (sentToken === secret ? '예' : '아니오 ← setWebhook 을 다시 실행하세요'));
    }
  }

  lines.push('allowed_telegram_ids: ' + (getConfigList('allowed_telegram_ids').join(', ') || '비어 있음 ← Config 탭을 채우세요'));
  lines.push('최근 Log 10줄:');
  lines.push(recentLogTail(10));
  lines.push('────────────');

  Logger.log(lines.join('\n'));
  return info;
}

/**
 * 배포 URL 을 직접 두드려 실제 상태 코드를 본다.
 * getWebhookInfo 의 "302 Found" 가 배포 설정 탓인지 Apps Script 의 정상 동작인지 가른다.
 *
 * 보내는 내용은 message 도 callback 도 없는 빈 update 다. 토큰 검사와 doPost 진입까지만
 * 확인하고 원장에는 아무것도 쓰지 않는다(Log 에 "[무시]" 한 줄만 남는다).
 * @return {?number} 상태 코드. 확인할 수 없으면 null
 */
function probeWebappUrl() {
  var base = optionalSecret('WEBAPP_URL');
  var secret = optionalSecret('WEBHOOK_SECRET');
  if (!base || !secret) {
    Logger.log('WEBAPP_URL 또는 WEBHOOK_SECRET 이 없습니다. Script Properties 를 확인하세요.');
    return null;
  }
  var url = base + (base.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(secret);
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ update_id: 'probe-' + new Date().getTime() }),
      followRedirects: false, // Telegram 도 리디렉션을 따라가지 않는다. 같은 조건으로 본다
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('배포 URL 호출 실패: ' + err);
    return null;
  }

  var code = response.getResponseCode();
  var location = '';
  try {
    var headers = response.getAllHeaders() || {};
    location = String(headers.Location || headers.location || '');
  } catch (ignored) {
    location = '';
  }

  var lines = ['── 배포 URL 응답 ──', 'HTTP ' + code];
  if (code === 200) {
    lines.push('곧바로 200 입니다. 웹 앱 자체는 Telegram 이 원하는 응답을 돌려줍니다.');
    lines.push('그런데도 getWebhookInfo 에 302 가 남아 있다면 등록된 웹훅이 예전 배포를 보고 있는 것입니다.');
    lines.push('→ Telegram.gs 의 setWebhook 을 다시 실행하세요.');
  } else if (code === 302 || code === 301) {
    lines.push('이동 위치: ' + (redirectHost(location) || '(헤더 없음)'));
    if (/accounts\.google\.com/.test(location)) {
      lines.push('로그인 화면으로 보냅니다. 배포의 "액세스 권한" 이 모든 사용자가 아닙니다.');
      lines.push('→ 배포 관리 → 연필 → 액세스 권한: 모든 사용자 → 새 버전으로 배포하세요.');
    } else if (/googleusercontent\.com/.test(location)) {
      lines.push('Apps Script 가 본문을 다른 도메인에서 내보내려고 합니다. 이때는 배포 설정 문제가 아닙니다.');
      lines.push('→ Telegram 은 이 이동을 따라가지 않아 실패로 기록하고 재시도합니다.');
      lines.push('→ setWebhook 으로 밀린 건을 비우면 당장은 회신이 돌아옵니다.');
    } else {
      lines.push('알 수 없는 이동입니다. 배포 설정을 다시 확인하세요.');
    }
  } else {
    lines.push('예상 밖의 응답입니다. 배포가 살아 있는지 확인하세요.');
  }
  lines.push('Log 탭 마지막 줄이 "[무시]" 면 요청이 doPost 까지 들어온 것입니다.');
  lines.push('──────────────');
  Logger.log(lines.join('\n'));
  return code;
}

/** 리디렉션 주소에서 도메인만 뽑는다. 전체 주소에는 토큰이 섞일 수 있다. */
function redirectHost(location) {
  var m = /^https?:\/\/([^/]+)/.exec(String(location || ''));
  return m ? m[1] : '';
}

/** 배포 URL 을 식별만 되게 줄인다. 전체 URL 은 비밀값이므로 찍지 않는다. */
function summarizeExecUrl(url) {
  var base = String(url).split('?')[0];
  var m = /\/macros\/s\/([^/]+)\//.exec(base);
  var tail = m ? '…' + m[1].slice(-6) : '…' + base.slice(-6);
  return '/macros/s/' + tail + '/' + base.split('/').pop() + (url.indexOf('token=') >= 0 ? ' (+token)' : ' (token 없음)');
}

/** Log 탭 마지막 N 줄을 진단용 한 덩어리 문자열로 만든다. */
function recentLogTail(limit) {
  try {
    var rows = readAll(SHEETS.LOG.name);
    if (!rows.length) {
      return '  (비어 있음) ← 요청이 이 스크립트에 닿지 않고 있습니다';
    }
    return rows.slice(-Math.max(1, limit || 10)).map(function (row) {
      return '  ' + String(row.timestamp) + ' | ' + String(row.telegram_id) +
        ' | ' + String(row.raw_text).slice(0, 30) + ' | ' + String(row.result).slice(0, 60);
    }).join('\n');
  } catch (err) {
    return '  Log 읽기 실패: ' + err;
  }
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
