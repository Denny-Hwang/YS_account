const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTransactionFromRow, normalizeLegacyAmount, normalizeLegacyDate, migRowId
} = require('../src/MigrationMap.js');

const MAP = {
  date: '날짜', merchant: '내역', amount: '금액', category: '분류',
  envelope: '봉투', memo: '메모', type: '구분', payer: '결제자'
};
const CTX = {
  tabName: '2025-01', rowNumber: 7, month: '2025-01',
  defaultCurrency: 'USD', fxUsdKrw: 1332, now: '2026-09-11T00:00:00.000Z',
  defaultType: 'expense', defaultKind: 'variable', defaultEnvelope: '기타'
};

test('금액 표기 정규화', () => {
  assert.deepEqual(normalizeLegacyAmount('1,234.56', 'USD'), { amount: 1234.56, currency: 'USD', negative: false });
  assert.deepEqual(normalizeLegacyAmount('$85.89', 'KRW'), { amount: 85.89, currency: 'USD', negative: false });
  assert.deepEqual(normalizeLegacyAmount('50,000원', 'USD'), { amount: 50000, currency: 'KRW', negative: false });
  assert.deepEqual(normalizeLegacyAmount('5만원', 'USD'), { amount: 50000, currency: 'KRW', negative: false });
  assert.deepEqual(normalizeLegacyAmount('(123)', 'USD'), { amount: 123, currency: 'USD', negative: true });
  assert.deepEqual(normalizeLegacyAmount(-45.5, 'USD'), { amount: 45.5, currency: 'USD', negative: true });
  assert.equal(normalizeLegacyAmount('', 'USD'), null);
  assert.equal(normalizeLegacyAmount(0, 'USD'), null);
  assert.equal(normalizeLegacyAmount('합계', 'USD'), null);
});

test('날짜 표기 정규화', () => {
  assert.equal(normalizeLegacyDate('2025-01-05', '2025-01'), '2025-01-05');
  assert.equal(normalizeLegacyDate('2025/1/5', '2025-01'), '2025-01-05');
  assert.equal(normalizeLegacyDate('1/5', '2025-01'), '2025-01-05');
  assert.equal(normalizeLegacyDate('1월 5일', '2025-01'), '2025-01-05');
  assert.equal(normalizeLegacyDate('5', '2025-01'), '2025-01-05');
  assert.equal(normalizeLegacyDate('5일', '2025-01'), '2025-01-05');
  assert.equal(normalizeLegacyDate('', '2025-01'), '2025-01-01');
  assert.equal(normalizeLegacyDate('2025-02-30', '2025-02'), null);
  assert.equal(normalizeLegacyDate('알 수 없음', '2025-01'), null);
});

test('행 id 는 탭과 행 번호로 결정된다', () => {
  assert.equal(migRowId('2025-01', 7), 'mig_2025-01_7');
  assert.equal(migRowId('1월 가계부', 3), 'mig_1월가계부_3');
  assert.equal(migRowId('2025-01', 7), migRowId('2025-01', 7));
});

test('일반 지출 행을 옮긴다', () => {
  const r = buildTransactionFromRow(
    { 날짜: '1/5', 내역: '코스트코', 금액: '85.89', 분류: '식료품', 봉투: '식료품', 메모: '', 구분: '', 결제자: '성주' },
    MAP, CTX
  );
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.transaction, {
    id: 'mig_2025-01_7', date: '2025-01-05', type: 'expense', kind: 'variable',
    category: '식료품', envelope: '식료품', merchant: '코스트코', amount: 85.89,
    currency: 'USD', amount_usd: 85.89, recurring_id: '', status: 'active',
    memo: '', payer: '성주', source: 'migration',
    created_at: CTX.now, updated_at: CTX.now, updated_by: 'migration'
  });
});

test('봉투가 비면 기본 봉투를 채운다', () => {
  const r = buildTransactionFromRow(
    { 날짜: '3', 내역: '편의점', 금액: '12.00', 분류: '', 봉투: '' }, MAP, CTX
  );
  assert.equal(r.transaction.envelope, '기타');
});

test('구분 열이 수입이면 type 이 income', () => {
  const r = buildTransactionFromRow(
    { 날짜: '10', 내역: '레슨비', 금액: '400', 구분: '수입' }, MAP, CTX
  );
  assert.equal(r.transaction.type, 'income');
});

test('구분 열이 없으면 음수를 수입으로 본다', () => {
  const r = buildTransactionFromRow(
    { 날짜: '10', 내역: '환급', 금액: -400 }, MAP, CTX
  );
  assert.equal(r.transaction.type, 'income');
  assert.equal(r.transaction.amount, 400);
});

test('KRW 는 fx 로 환산한다', () => {
  const r = buildTransactionFromRow(
    { 날짜: '10', 내역: '부모님 송금', 금액: '50,000원' }, MAP, CTX
  );
  assert.equal(r.transaction.currency, 'KRW');
  assert.equal(r.transaction.amount, 50000);
  assert.equal(r.transaction.amount_usd, 37.54);
});

test('빈 행은 blank, 읽지 못한 행은 error', () => {
  assert.equal(buildTransactionFromRow({ 날짜: '', 내역: '', 금액: '' }, MAP, CTX).status, 'blank');
  const bad = buildTransactionFromRow({ 날짜: '', 내역: '합계', 금액: '' }, MAP, CTX);
  assert.equal(bad.status, 'error');
  const badDate = buildTransactionFromRow({ 날짜: '언젠가', 내역: '무언가', 금액: '10' }, MAP, CTX);
  assert.equal(badDate.status, 'error');
  assert.match(badDate.reason, /날짜/);
});
