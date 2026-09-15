const test = require('node:test');
const assert = require('node:assert/strict');
const {
  daysInMonth, remainingDaysInclToday, envelopeStatus, formatStatusLine, formatStatusShort,
  formatUsd, formatSigned, signalOf
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
  assert.equal(s.allowanceLeftToday, 38.33);
  assert.equal(s.plannedPaceToDate, 333.33);
  assert.equal(s.deltaVsPlan, 138.31);
  assert.equal(s.signal, 'green');
});

test('오늘 지출은 하루치(allowanceToday)는 그대로 두고 오늘 남은(allowanceLeftToday)만 낮춘다', () => {
  const s = envelopeStatus({
    budget: 1000,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 195.02), tx('2026-09-10', 40)]
  });
  assert.equal(s.spentToday, 40);
  assert.equal(s.spentTotal, 235.02);
  assert.equal(s.allowanceToday, 38.33);
  assert.equal(s.allowanceLeftToday, -1.67);
  assert.equal(s.remaining, 764.98);
});

test('환불(음수 금액)은 같은 세부예산의 지출을 줄인다', () => {
  const s = envelopeStatus({
    budget: 500,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 100), tx('2026-09-03', -20)]
  });
  assert.equal(s.spentTotal, 80);
  assert.equal(s.remaining, 420);
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

test('status=confirmed 행은 포함하고 expected 는 제외한다', () => {
  const s = envelopeStatus({
    budget: 500,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 100, { status: 'confirmed' }), tx('2026-09-04', 50, { status: 'expected' })]
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

test('다른 세부예산과 다른 달의 행은 제외한다', () => {
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

test('예산 초과 시 음수를 허용하고 빨강이다', () => {
  const s = envelopeStatus({
    budget: 100,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [tx('2026-09-02', 250)]
  });
  assert.equal(s.remaining, -150);
  assert.equal(s.allowanceToday, -7.14); // (100 - 250) / 21
  assert.ok(s.deltaVsPlan < 0);
  assert.equal(s.signal, 'red');
});

test('신호등: 계획보다 앞서 썼지만 예산의 10% 이내면 노랑, 넘으면 빨강', () => {
  assert.equal(signalOf({ budget: 1000, remaining: 500, deltaVsPlan: -50 }), 'yellow');
  assert.equal(signalOf({ budget: 1000, remaining: 500, deltaVsPlan: -100 }), 'yellow');
  assert.equal(signalOf({ budget: 1000, remaining: 500, deltaVsPlan: -101 }), 'red');
  assert.equal(signalOf({ budget: 1000, remaining: 500, deltaVsPlan: 0 }), 'green');
  assert.equal(signalOf({ budget: 0, remaining: 0, deltaVsPlan: 0 }), 'green');
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
  assert.equal(formatSigned(12.3), '+$12.30');
  assert.equal(formatSigned(-12.3), '-$12.30');
});

test('formatStatusLine 은 신호등과 "오늘 남은" 을 앞에 둔다', () => {
  const s = envelopeStatus({
    budget: 1000, envelope: '식료품', today: '2026-09-10',
    transactions: [tx('2026-09-02', 195.02), tx('2026-09-10', 20)]
  });
  assert.equal(
    formatStatusLine(s, '식료품'),
    '🟢 식료품 오늘 남은 $18.33 · 하루치 $38.33 · 잔액 $784.98 · 계획 대비 +$118.31'
  );
  assert.equal(formatStatusShort(s, '식료품'), '🟢 식료품 오늘 $18.33');
});

test('계획보다 많이 썼으면 음수 표기와 빨강', () => {
  const s = envelopeStatus({
    budget: 1000, envelope: '식료품', today: '2026-09-10',
    transactions: [tx('2026-09-02', 500)]
  });
  const line = formatStatusLine(s, '식료품');
  assert.ok(line.startsWith('🔴'));
  assert.ok(line.includes('계획 대비 -$'));
});
