/**
 * Classifier.js — 순수 모듈. Merchants 사전에서 가맹점 텍스트에 맞는 행을 찾는다.
 * Google 서비스에 의존하지 않는다.
 */

/**
 * 비교용 정규화: 소문자로 바꾸고 공백·구두점·기호를 모두 제거한다.
 * 한글·영문·숫자만 남긴다.
 * @param {string} s
 * @return {string}
 */
function normalize(s) {
  return String(s === null || s === undefined ? '' : s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * 사전에서 최장 일치 keyword 를 찾는다.
 * 정규화한 merchantText 안에 정규화한 keyword 가 포함되면 후보로 본다.
 * 후보가 여럿이면 keyword 가 긴 쪽, 길이가 같으면 hit_count 가 큰 쪽을 고른다.
 * @param {string} merchantText
 * @param {!Array<!Object>} merchants Merchants 탭 객체 배열
 * @return {?Object} 매칭 행 또는 null
 */
function classify(merchantText, merchants) {
  var target = normalize(merchantText);
  if (!target || !merchants || merchants.length === 0) {
    return null;
  }
  var best = null;
  var bestLen = -1;
  var bestHits = -1;
  for (var i = 0; i < merchants.length; i++) {
    var row = merchants[i];
    if (!row) {
      continue;
    }
    var key = normalize(row.keyword);
    if (!key || target.indexOf(key) < 0) {
      continue;
    }
    var hits = Number(row.hit_count) || 0;
    if (key.length > bestLen || (key.length === bestLen && hits > bestHits)) {
      best = row;
      bestLen = key.length;
      bestHits = hits;
    }
  }
  return best;
}

if (typeof module !== 'undefined') {
  module.exports = { classify: classify, normalize: normalize };
}
