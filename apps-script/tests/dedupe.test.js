const test = require('node:test');
const assert = require('node:assert/strict');
const { isDuplicateUpdate } = require('../src/Dedupe.js');

test('처음 보는 update_id 는 중복이 아니다', () => {
  assert.equal(isDuplicateUpdate(1001, false, [998, 999, 1000]), false);
});

test('캐시에 있으면 중복이다', () => {
  assert.equal(isDuplicateUpdate(1001, true, []), true);
});

test('캐시에 없어도 최근 Log 에 있으면 중복이다', () => {
  assert.equal(isDuplicateUpdate(1001, false, [999, '1001', 1002]), true);
});
