const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMessage } = require('../src/Parser.js');

const CTX = { today: '2026-09-10', defaultCurrency: 'USD', fxUsdKrw: 1332 };

test('기본 지출: "코스트코 85.89"', () => {
  const r = parseMessage('코스트코 85.89', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.type, 'expense');
  assert.equal(r.amount, 85.89);
  assert.equal(r.currency, 'USD');
  assert.equal(r.amount_usd, 85.89);
  assert.equal(r.date, '2026-09-10');
  assert.equal(r.merchantText, '코스트코');
  assert.equal(r.confidence, 'high');
});

test('어제 날짜: "어제 세이프웨이 13.97"', () => {
  const r = parseMessage('어제 세이프웨이 13.97', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.date, '2026-09-09');
  assert.equal(r.amount, 13.97);
  assert.equal(r.merchantText, '세이프웨이');
  assert.equal(r.confidence, 'high');
});

test('그제 날짜는 이틀 전', () => {
  assert.equal(parseMessage('그제 밤부마켓 20', CTX).date, '2026-09-08');
  assert.equal(parseMessage('그저께 밤부마켓 20', CTX).date, '2026-09-08');
});

test('원화 만원 단위: "5만원 송금 부모님"', () => {
  const r = parseMessage('5만원 송금 부모님', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.amount, 50000);
  assert.equal(r.currency, 'KRW');
  assert.equal(r.amount_usd, 37.54); // 50000 / 1332
  assert.equal(r.merchantText, '송금 부모님');
  assert.equal(r.confidence, 'high');
});

test('원화 표기 변형: 50000원 / ₩50,000', () => {
  const a = parseMessage('50000원 택배', CTX);
  assert.equal(a.amount, 50000);
  assert.equal(a.currency, 'KRW');
  const b = parseMessage('₩50,000 택배', CTX);
  assert.equal(b.amount, 50000);
  assert.equal(b.currency, 'KRW');
  assert.equal(b.merchantText, '택배');
});

test('달러 표기 변형: $85.89 / 85불', () => {
  const a = parseMessage('$85.89 코스트코', CTX);
  assert.equal(a.amount, 85.89);
  assert.equal(a.currency, 'USD');
  assert.equal(a.merchantText, '코스트코');
  const b = parseMessage('주차 85불', CTX);
  assert.equal(b.amount, 85);
  assert.equal(b.currency, 'USD');
  assert.equal(b.merchantText, '주차');
});

test('수입 힌트: "레슨 윤지 40"', () => {
  const r = parseMessage('레슨 윤지 40', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.type, 'income');
  assert.equal(r.amount, 40);
  assert.equal(r.currency, 'USD');
  assert.equal(r.merchantText, '윤지');
  assert.equal(r.merchantTextRaw, '레슨 윤지'); // 사전 조회는 힌트 제거 전 문자열도 쓴다
  assert.equal(r.confidence, 'high');
});

test('조회 의도: "얼마 남았어"', () => {
  const r = parseMessage('얼마 남았어', CTX);
  assert.equal(r.intent, 'query');
  assert.equal(r.amount, null);
});

test('조회 의도 변형: 잔액 / 상태 / 오늘', () => {
  assert.equal(parseMessage('잔액', CTX).intent, 'query');
  assert.equal(parseMessage('상태 알려줘', CTX).intent, 'query');
  assert.equal(parseMessage('오늘', CTX).intent, 'query');
  assert.equal(parseMessage('남은 예산', CTX).intent, 'query');
});

test('취소 의도: "취소" / "undo"', () => {
  assert.equal(parseMessage('취소', CTX).intent, 'undo');
  assert.equal(parseMessage('undo', CTX).intent, 'undo');
});

test('금액이 둘 이상이면 confidence low', () => {
  const r = parseMessage('85.89 12.50 뭔가', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.amount, 85.89);
  assert.equal(r.confidence, 'low');
  assert.equal(r.memo, '85.89 12.50 뭔가');
});

test('금액 없는 단어는 unknown: "주유"', () => {
  const r = parseMessage('주유', CTX);
  assert.equal(r.intent, 'unknown');
  assert.equal(r.amount, null);
});

test('미지원 단위 12.5k 는 unknown', () => {
  const r = parseMessage('코스트코 12.5k', CTX);
  assert.equal(r.intent, 'unknown');
  assert.equal(r.confidence, 'low');
  assert.equal(r.amount, null);
});

test('슬래시 날짜: "9/8 주유 52"', () => {
  const r = parseMessage('9/8 주유 52', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.date, '2026-09-08');
  assert.equal(r.amount, 52);
  assert.equal(r.merchantText, '주유');
  assert.equal(r.confidence, 'high');
});

test('대시 날짜 09-08 과 전체 날짜 2026-09-08', () => {
  assert.equal(parseMessage('09-08 주유 52', CTX).date, '2026-09-08');
  assert.equal(parseMessage('2026-09-08 주유 52', CTX).date, '2026-09-08');
});

test('미래 날짜는 오늘로 강제하고 low', () => {
  const r = parseMessage('9/20 주유 52', CTX);
  assert.equal(r.date, '2026-09-10');
  assert.equal(r.confidence, 'low');
});

test('가맹점 텍스트가 비면 low', () => {
  const r = parseMessage('42', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.merchantText, '');
  assert.equal(r.confidence, 'low');
});

test('빈 입력은 null', () => {
  assert.equal(parseMessage('', CTX), null);
  assert.equal(parseMessage(null, CTX), null);
  assert.equal(parseMessage('   ', CTX), null);
});
