/**
 * Dedupe.js — 순수 모듈. Telegram update 의 중복 여부만 판정한다.
 * Google 서비스에 의존하지 않는다(캐시 조회와 Log 읽기는 호출자가 해서 인자로 넘긴다).
 */

/** 숫자든 문자열이든 같은 id 를 같은 문자열로 맞춘다. */
function normalizeUpdateId(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

/**
 * 이미 처리한 update 인지 판정한다.
 * Telegram 은 2xx 응답을 제때 받지 못하면 같은 update 를 재전송하므로,
 * 같은 update_id 를 두 번 처리하면 원장에 같은 행이 중복으로 쌓인다.
 *
 * @param {(string|number|null|undefined)} updateId Telegram update.update_id
 * @param {boolean} cacheHit 캐시에 이미 이 update_id 가 있었는지
 * @param {!Array<(string|number)>} recentLogIds Log 탭 최근 행의 update_id 목록
 * @return {boolean} true 면 처리하지 않고 바로 200 을 반환해야 한다
 */
function isDuplicateUpdate(updateId, cacheHit, recentLogIds) {
  var id = normalizeUpdateId(updateId);
  if (!id) {
    return false; // update_id 가 없으면 멱등 판정을 할 수 없으므로 정상 처리한다
  }
  if (cacheHit === true) {
    return true;
  }
  var list = recentLogIds || [];
  for (var i = 0; i < list.length; i++) {
    if (normalizeUpdateId(list[i]) === id) {
      return true; // 캐시가 비워졌어도 Log 에 흔적이 남아 있으면 중복이다
    }
  }
  return false;
}

if (typeof module !== 'undefined') {
  module.exports = {
    isDuplicateUpdate: isDuplicateUpdate,
    normalizeUpdateId: normalizeUpdateId
  };
}
