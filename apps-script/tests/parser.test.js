const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMessage, pickAmount, extractMove } = require('../src/Parser.js');

const CTX = { today: '2026-09-10', defaultCurrency: 'USD', fxUsdKrw: 1332 };
const CTX_LESSON = Object.assign({}, CTX, { incomeHints: ['수입', '급여', '입금', '레슨'] });

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
  assert.equal(r.ambiguous, false);
  assert.equal(r.refund, false);
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

test('수입 힌트는 ctx.incomeHints 로 정한다: "레슨 학생A 40"', () => {
  const r = parseMessage('레슨 학생A 40', CTX_LESSON);
  assert.equal(r.intent, 'record');
  assert.equal(r.type, 'income');
  assert.equal(r.amount, 40);
  assert.equal(r.merchantText, '학생A');
  assert.equal(r.merchantTextRaw, '레슨 학생A'); // 사전 조회는 힌트 제거 전 문자열도 쓴다
  assert.equal(r.confidence, 'high');
  // 기본 힌트에는 레슨이 없다. 아이 레슨비를 지출로 적는 집도 있기 때문이다.
  assert.equal(parseMessage('피아노 레슨비 120', CTX).type, 'expense');
});

test('환불 힌트: 같은 봉투의 음수 지출', () => {
  const r = parseMessage('환불 코스트코 20', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.type, 'expense');
  assert.equal(r.refund, true);
  assert.equal(r.amount, -20);
  assert.equal(r.amount_usd, -20);
  assert.equal(r.merchantText, '코스트코');
  const k = parseMessage('반품 3만원 다이소', CTX);
  assert.equal(k.amount, -30000);
  assert.equal(k.currency, 'KRW');
  assert.equal(k.amount_usd, -22.52);
});

test('조회 의도: "얼마 남았어"', () => {
  const r = parseMessage('얼마 남았어', CTX);
  assert.equal(r.intent, 'query');
  assert.equal(r.amount, null);
});

test('조회 의도 변형: 잔액 / 상태 / 오늘 / 요약', () => {
  assert.equal(parseMessage('잔액', CTX).intent, 'query');
  assert.equal(parseMessage('상태 알려줘', CTX).intent, 'query');
  assert.equal(parseMessage('오늘', CTX).intent, 'query');
  assert.equal(parseMessage('남은 예산', CTX).intent, 'query');
  assert.equal(parseMessage('요약', CTX).intent, 'query');
});

test('취소 의도: "취소" / "undo"', () => {
  assert.equal(parseMessage('취소', CTX).intent, 'undo');
  assert.equal(parseMessage('undo', CTX).intent, 'undo');
});

test('봉투 이동 의도', () => {
  const a = parseMessage('이동 예비비→식료품 50', CTX);
  assert.equal(a.intent, 'move');
  assert.equal(a.moveFrom, '예비비');
  assert.equal(a.moveTo, '식료품');
  assert.equal(a.amount_usd, 50);
  const b = parseMessage('예비비에서 식료품으로 30 이동', CTX);
  assert.equal(b.intent, 'move');
  assert.equal(b.moveFrom, '예비비');
  assert.equal(b.moveTo, '식료품');
  assert.equal(b.amount_usd, 30);
  const c = parseMessage('이동 예비비 -> 생필품 2만원', CTX);
  assert.equal(c.intent, 'move');
  assert.equal(c.amount_usd, 15.02);
  assert.equal(extractMove('코스트코 85.89'), null);
});

test('숫자가 여럿이면 확실한 후보(단위·소수점)를 고른다', () => {
  const a = parseMessage('물 2병 5.99', CTX);
  assert.equal(a.amount, 5.99);
  assert.equal(a.ambiguous, false);
  assert.equal(a.confidence, 'high');
  assert.equal(a.merchantText, '물 2병');
  const b = parseMessage('코스트코 3개 $85.89', CTX);
  assert.equal(b.amount, 85.89);
  assert.equal(b.ambiguous, false);
  const c = parseMessage('사과 3 2만원', CTX);
  assert.equal(c.amount, 20000);
  assert.equal(c.currency, 'KRW');
});

test('같은 확신의 숫자가 둘 이상이면 마지막을 고르고 ambiguous 로 표시한다', () => {
  const r = parseMessage('85.89 12.50 뭔가', CTX);
  assert.equal(r.intent, 'record');
  assert.equal(r.amount, 12.5);
  assert.equal(r.ambiguous, true);
  assert.equal(r.confidence, 'low');
  assert.deepEqual(r.amountCandidates, [
    { amount: 85.89, currency: 'USD' }, { amount: 12.5, currency: 'USD' }
  ]);
  assert.equal(r.memo, '85.89 12.50 뭔가');
  assert.equal(pickAmount([{ amount: 2, score: 1 }, { amount: 3, score: 1 }]).ambiguous, true);
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

test('대시 날짜는 맨 앞에서만: 09-08 / 2026-09-08 은 되고 "7-11 5.50" 은 가맹점', () => {
  assert.equal(parseMessage('09-08 주유 52', CTX).date, '2026-09-08');
  assert.equal(parseMessage('2026-09-08 주유 52', CTX).date, '2026-09-08');
  const r = parseMessage('편의점 7-11 5.50', CTX);
  assert.equal(r.date, '2026-09-10');
  assert.equal(r.amount, 5.5);
  assert.equal(r.merchantText, '편의점 7-11');
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
