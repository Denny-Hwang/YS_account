const test = require('node:test');
const assert = require('node:assert/strict');
const {
  daysInMonth, remainingDaysInclToday, envelopeStatus, formatStatusLine, formatUsd
} = require('../src/Budget.js');

function tx(date, amountUsd, extra) {
  return Object.assign({
    date, type: 'expense', kind: 'variable', status: 'active',
    envelope: '식료품', amount_usd: amountUsd
  }, extra || {});
}

test('daysInMonth', () => {
  assert.equal(daysInMonth('2026-09'), 30);
  assert.equal(daysInMonth('2026-02'), 28);
  assert.equal(daysInMonth('2028-02'), 29);
  assert.equal(daysInMonth('2026-12'), 31);
  assert.equal(daysInMonth('bad'), 0);
});

test('remainingDaysInclToday 는 오늘을 포함한다', () => {
  assert.equal(remainingDaysInclToday('2026-09-10'), 21);
  assert.equal(remainingDaysInclToday('2026-09-30'), 1);
  assert.equal(remainingDaysInclToday('2026-09-01'), 30);
});

test('9/10, 예산 1000, 이전 지출 195.02, 오늘 0 → 가용액 38.33', () => {
  const s = envelopeStatus({
    budget: 1000,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 120.02), tx('2026-09-05', 75.00)]
  });
  assert.equal(s.spentBeforeToday, 195.02);
  assert.equal(s.spentToday, 0);
  assert.equal(s.spentTotal, 195.02);
  assert.equal(s.remaining, 804.98);
  assert.equal(s.remainingDays, 21);
  assert.equal(s.allowanceToday, 38.33);
  assert.equal(s.plannedPaceToDate, 333.33);
  assert.equal(s.deltaVsPlan, 138.31);
});

test('오늘 지출은 spentToday 에만 들어가고 가용액을 낮추지 않는다', () => {
  const s = envelopeStatus({
    budget: 1000,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 195.02), tx('2026-09-10', 40)]
  });
  assert.equal(s.spentToday, 40);
  assert.equal(s.spentTotal, 235.02);
  assert.equal(s.allowanceToday, 38.33);
  assert.equal(s.remaining, 764.98);
});

test('status=deleted 행은 제외한다', () => {
  const s = envelopeStatus({
    budget: 500,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 100), tx('2026-09-03', 999, { status: 'deleted' })]
  });
  assert.equal(s.spentTotal, 100);
});

test('status=confirmed 행은 포함한다', () => {
  const s = envelopeStatus({
    budget: 500,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 100, { status: 'confirmed' })]
  });
  assert.equal(s.spentTotal, 100);
});

test('kind=fixed 행은 제외한다', () => {
  const s = envelopeStatus({
    budget: 500,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 100), tx('2026-09-03', 2100, { kind: 'fixed' })]
  });
  assert.equal(s.spentTotal, 100);
});

test('다른 봉투와 다른 달의 행은 제외한다', () => {
  const s = envelopeStatus({
    budget: 500,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [
      tx('2026-09-02', 100),
      tx('2026-09-03', 50, { envelope: '생필품' }),
      tx('2026-08-30', 70)
    ]
  });
  assert.equal(s.spentTotal, 100);
});

test('수입 행은 지출로 세지 않는다', () => {
  const s = envelopeStatus({
    budget: 500,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 100), tx('2026-09-04', 300, { type: 'income' })]
  });
  assert.equal(s.spentTotal, 100);
});

test('예산 초과 시 음수를 허용한다', () => {
  const s = envelopeStatus({
    budget: 100,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 250)]
  });
  assert.equal(s.remaining, -150);
  assert.equal(s.allowanceToday, -7.14); // (100 - 250) / 21
  assert.ok(s.deltaVsPlan < 0);
});

test('말일에는 남은 일수가 1이다', () => {
  const s = envelopeStatus({
    budget: 300, envelope: '식료품', today: '2026-09-30',
    transactions: [tx('2026-09-02', 100)]
  });
  assert.equal(s.remainingDays, 1);
  assert.equal(s.allowanceToday, 200);
});

test('formatUsd 는 천 단위 콤마와 음수를 처리한다', () => {
  assert.equal(formatUsd(771.3), '$771.30');
  assert.equal(formatUsd(1234.5), '$1,234.50');
  assert.equal(formatUsd(-12.3), '-$12.30');
});

test('formatStatusLine 한 줄 형식', () => {
  const s = envelopeStatus({
    budget: 1000, envelope: '식료품', today: '2026-09-10',
    transactions: [tx('2026-09-02', 195.02)]
  });
  assert.equal(
    formatStatusLine(s, '식료품'),
    '식료품 잔액 $804.98 · 남은 21일 × $38.33/일 · 계획 대비 +$138.31'
  );
});

test('계획보다 많이 썼으면 음수 표기', () => {
  const s = envelopeStatus({
    budget: 1000, envelope: '식료품', today: '2026-09-10',
    transactions: [tx('2026-09-02', 500)]
  });
  assert.ok(formatStatusLine(s, '식료품').includes('계획 대비 -$'));
});
