const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pickConfirmTarget, matchRecurringName, undoPlan, nextMonthBudgets, budgetDuplicateRows, amortizeOnce, payoffMonths, monthScore,
  parseAmountRule, biweeklyPaydays, expectedAmountFor, matchPaydaySlots, biweeklyRuleString
} = require('../src/LedgerRules.js');

test('확정 대상은 expected 행뿐이다. confirmed 는 덮어쓰지 않는다', () => {
  const rows = [
    { id: 'a', recurring_id: 'R06', status: 'confirmed' },
    { id: 'b', recurring_id: 'R02', status: 'expected' },
    { id: 'c', recurring_id: 'R06', status: 'deleted' }
  ];
  const fuel = pickConfirmTarget(rows, 'R06');
  assert.equal(fuel.target, null);
  assert.equal(fuel.confirmedCount, 1);
  const mgmt = pickConfirmTarget(rows, 'R02');
  assert.equal(mgmt.target.id, 'b');
  assert.equal(mgmt.confirmedCount, 0);
  assert.deepEqual(pickConfirmTarget([], 'R09'), { target: null, confirmedCount: 0 });
});

test('Recurring 이름 매칭은 active=Y, kind=fixed 만, 긴 이름 우선', () => {
  const defs = [
    { id: 'R12', name: '한국 대출 상환', kind: 'fixed', active: 'Y' },
    { id: 'R09', name: '대출', kind: 'fixed', active: 'Y' },
    { id: 'R99', name: '옛날 대출', kind: 'fixed', active: 'N' },
    { id: 'I02', name: '레슨', kind: 'variable', active: 'Y', type: 'income' }
  ];
  assert.equal(matchRecurringName('한국 대출 상환 100만원', defs).id, 'R12');
  assert.equal(matchRecurringName('대출 500', defs).id, 'R09');
  assert.equal(matchRecurringName('옛날 대출 10', defs).id, 'R09');
  assert.equal(matchRecurringName('레슨 40', defs), null);
  assert.equal(matchRecurringName('', defs), null);
});

test('되돌리기: 추가한 행은 삭제, 확정한 행은 expected 로 복원', () => {
  const del = undoPlan({ status: 'active', source: 'telegram' }, { mode: 'append' });
  assert.equal(del.action, 'delete');
  const rev = undoPlan(
    { status: 'confirmed', source: 'recurring' },
    { mode: 'confirm', previous: { amount: 207, currency: 'USD', amount_usd: 207, date: '2026-09-01' } }
  );
  assert.equal(rev.action, 'revert');
  assert.deepEqual(rev.patch, { status: 'expected', payer: '', amount: 207, currency: 'USD', amount_usd: 207, date: '2026-09-01' });
  // 캐시가 없어도 행 자체로 confirm 이었음을 알 수 있으면 예상 금액으로 되돌린다.
  const fb = undoPlan({ status: 'confirmed', source: 'recurring' }, null, { amount: 200, currency: 'USD', amount_usd: 200 });
  assert.equal(fb.action, 'revert');
  assert.equal(fb.patch.amount, 200);
  assert.equal(fb.patch.status, 'expected');
});

test('다음 달 예산: carry 는 양수 잔액만 이월, 초과분은 흡수 세부예산에서 뺀다', () => {
  const prev = [
    { envelope: '식료품', amount: 1000, carryover: 'reset' },
    { envelope: '생필품', amount: 100, carryover: 'reset' },
    { envelope: '예비비', amount: 100, carryover: 'carry' },
    { envelope: '연간비', amount: 50, carryover: 'carry' }
  ];
  const status = {
    '식료품': { remaining: -80 },
    '생필품': { remaining: 20 },
    '예비비': { remaining: 60 },
    '연간비': { remaining: 50 }
  };
  const next = nextMonthBudgets(prev, status, '예비비');
  const by = Object.fromEntries(next.map((r) => [r.envelope, r]));
  assert.equal(by['식료품'].amount, 1000);
  assert.equal(by['생필품'].amount, 100);
  assert.equal(by['예비비'].amount, 80); // 100 + 60 이월 − 80 초과 흡수
  assert.equal(by['연간비'].amount, 100); // 50 + 50 이월 (싱킹 펀드)
  assert.equal(by['연간비'].carryover, 'carry');
  assert.match(by['식료품'].note, /초과 80/);
});

test('다음 달 예산: 흡수 세부예산이 없으면 초과분은 사라지고, carry 세부예산의 음수는 이월하지 않는다', () => {
  const next = nextMonthBudgets(
    [{ envelope: '식료품', amount: 1000, carryover: 'carry' }],
    { '식료품': { remaining: -30 } },
    ''
  );
  assert.equal(next[0].amount, 1000);
});

test('상각: 이자를 뺀 나머지가 원금을 줄인다', () => {
  const r = amortizeOnce(10000, 12, 500);
  assert.equal(r.interest, 100);
  assert.equal(r.principalPaid, 400);
  assert.equal(r.newPrincipal, 9600);
  assert.equal(amortizeOnce(100, 0, 500).newPrincipal, 0);
  assert.equal(amortizeOnce(10000, 12, 50).principalPaid, 0);
});

test('상환 종료까지 개월 수', () => {
  assert.equal(payoffMonths(1000, 0, 100), 10);
  assert.equal(payoffMonths(0, 5, 100), 0);
  assert.equal(payoffMonths(10000, 12, 50), null); // 이자보다 작은 상환
  const m = payoffMonths(21080, 11.89, 1412);
  assert.ok(m >= 16 && m <= 18, `이자 반영 시 회차보다 길다: ${m}`);
});

test('월 마감 점수', () => {
  const s = monthScore({ income: 5000, expense: 4000 }, [{ remaining: 10 }, { remaining: -5 }, { remaining: 0 }], 2);
  assert.deepEqual(s, { savingRate: 20, withinBudget: 2, envelopes: 3, deviations: 2 });
  assert.equal(monthScore({ income: 0, expense: 10 }, [], 0).savingRate, null);
});

test('amount_rule 해석: fixed / income_pct / biweekly', () => {
  assert.deepEqual(parseAmountRule('fixed'), { type: 'fixed' });
  assert.deepEqual(parseAmountRule(''), { type: 'fixed' });
  assert.deepEqual(parseAmountRule('income_pct:10'), { type: 'income_pct', pct: 10 });
  assert.deepEqual(parseAmountRule('biweekly:2600@2026-01-02'), { type: 'biweekly', perCheck: 2600, anchor: '2026-01-02' });
  // 날짜가 아니거나 형식이 틀리면 fixed 로 물러난다
  assert.deepEqual(parseAmountRule('biweekly:2600'), { type: 'fixed' });
  assert.deepEqual(parseAmountRule('biweekly:2600@2026-13-01'), { type: 'biweekly', perCheck: 2600, anchor: '2026-13-01' });
});

test('2주급 급여일: 1년 26회, 두 달만 3회', () => {
  const anchor = '2026-01-02';
  assert.deepEqual(biweeklyPaydays('2026-01', anchor), ['2026-01-02', '2026-01-16', '2026-01-30']);
  assert.deepEqual(biweeklyPaydays('2026-02', anchor), ['2026-02-13', '2026-02-27']);
  assert.deepEqual(biweeklyPaydays('2026-07', anchor), ['2026-07-03', '2026-07-17', '2026-07-31']);
  assert.deepEqual(biweeklyPaydays('2026-08', anchor), ['2026-08-14', '2026-08-28']);

  const months = [];
  for (let m = 1; m <= 12; m++) months.push(`2026-${String(m).padStart(2, '0')}`);
  const counts = months.map((m) => biweeklyPaydays(m, anchor).length);
  assert.equal(counts.reduce((a, b) => a + b, 0), 26, '한 해에 26번이어야 한다');
  assert.equal(counts.filter((c) => c === 3).length, 2, '3번 받는 달이 정확히 둘이어야 한다');
});

test('2주급 급여일: 기준일이 미래여도 뒤로 세고, 잘못된 값은 빈 배열', () => {
  assert.deepEqual(biweeklyPaydays('2025-12', '2026-01-02'), ['2025-12-05', '2025-12-19']);
  assert.deepEqual(biweeklyPaydays('2026-01', 'bad'), []);
  assert.deepEqual(biweeklyPaydays('bad', '2026-01-02'), []);
});

test('2주급 기준일 11-06: 11월 6·20일, 12월 4·18일, 1월은 세 번', () => {
  assert.deepEqual(biweeklyPaydays('2026-11', '2026-11-06'), ['2026-11-06', '2026-11-20']);
  assert.deepEqual(biweeklyPaydays('2026-12', '2026-11-06'), ['2026-12-04', '2026-12-18']);
  assert.deepEqual(biweeklyPaydays('2027-01', '2026-11-06'), ['2027-01-01', '2027-01-15', '2027-01-29']);
});

test('급여일 짝짓기: 가까운 급여일에 하나씩, 7일 넘게 먼 행은 남는다', () => {
  const paydays = ['2026-11-06', '2026-11-20'];
  // 기록 없음 → 두 자리 모두 빈칸
  assert.deepEqual(matchPaydaySlots(paydays, []).slots.map((s) => s.row), [null, null]);

  // 첫 급여가 하루 늦게 들어왔다
  const late = { id: 'a', date: '2026-11-07', status: 'confirmed' };
  let r = matchPaydaySlots(paydays, [late]);
  assert.equal(r.slots[0].row, late);
  assert.equal(r.slots[1].row, null);

  // 예전 방식(첫 급여일 예정 행 하나)도 첫 자리에 붙는다
  const old = { id: 'b', date: '2026-11-06', status: 'expected' };
  r = matchPaydaySlots(paydays, [old]);
  assert.equal(r.slots[0].row, old);

  // 같은 급여일 두 번째 기록과 동떨어진 보너스는 extras
  const dup = { id: 'c', date: '2026-11-06', status: 'confirmed' };
  const bonus = { id: 'd', date: '2026-11-30', status: 'confirmed' };
  r = matchPaydaySlots(paydays, [dup, old, bonus]);
  assert.equal(r.slots[0].row.id, 'c');
  assert.equal(r.slots[1].row, null); // 11-06 짜리 두 번째 행은 14일 떨어진 20일에 붙지 않는다
  assert.deepEqual(r.extras.map((x) => x.id).sort(), ['b', 'd']);
});

test('2주급 규칙 문자열', () => {
  assert.equal(biweeklyRuleString(3000, '2026-11-06'), 'biweekly:3000@2026-11-06');
  assert.equal(biweeklyRuleString(3012.456, '2026-11-06'), 'biweekly:3012.46@2026-11-06');
  assert.equal(biweeklyRuleString(0, '2026-11-06'), '');
  assert.equal(biweeklyRuleString(3000, '11/06'), '');
  assert.deepEqual(parseAmountRule(biweeklyRuleString(3012.46, '2026-11-06')), { type: 'biweekly', perCheck: 3012.46, anchor: '2026-11-06' });
});

test('예상 금액: 2주급은 급여일 수만큼, 나머지는 규칙대로', () => {
  const salary = { expected_amount: 5200, amount_rule: 'biweekly:2600@2026-01-02' };
  assert.equal(expectedAmountFor(salary, '2026-02', 0), 5200); // 2번
  assert.equal(expectedAmountFor(salary, '2026-01', 0), 7800); // 3번
  assert.equal(expectedAmountFor(salary, '2026-07', 0), 7800); // 3번

  const tithe = { expected_amount: 100, amount_rule: 'income_pct:10' };
  assert.equal(expectedAmountFor(tithe, '2026-02', 5200), 520);
  assert.equal(expectedAmountFor(tithe, '2026-02', 0), 100); // 수입 기록 전에는 expected_amount

  const rent = { expected_amount: 2100, amount_rule: 'fixed' };
  assert.equal(expectedAmountFor(rent, '2026-02', 9999), 2100);

  // 규칙을 못 읽으면 expected_amount 로 물러난다
  assert.equal(expectedAmountFor({ expected_amount: 42, amount_rule: 'biweekly:100@nope' }, '2026-02', 0), 42);
});

test('예산 중복 행: 맨 위 행은 남기고 그 아래 0 원 행만 아래부터 고른다', () => {
  const plan = budgetDuplicateRows([
    { row: 2, month: '2026-09', envelope: '식료품', amount: 1000 },
    { row: 3, month: '2026-09', envelope: '생필품', amount: 0 },
    { row: 5, month: '2026-09', envelope: '식료품', amount: 0 },
    { row: 4, month: '2026-09', envelope: '식료품', amount: '' },
    { row: 6, month: '2026-09', envelope: '생필품', amount: 0 },
    { row: 7, month: '2026-10', envelope: '식료품', amount: 0 },
    { row: 8, month: '2026-09', envelope: '식료품', amount: 50 },
    { row: 9, month: '', envelope: '식료품', amount: 0 }
  ]);
  assert.deepEqual(plan.remove.map((r) => r.row), [6, 5, 4]);
  // 맨 위가 0 이어도 맨 위는 남긴다(읽히는 행이 바뀌면 안 된다). 다른 달은 별개다.
  assert.ok(!plan.remove.some((r) => r.row === 3 || r.row === 7));
  // 0 이 아닌 아래 행은 지우지 않고 알린다.
  assert.deepEqual(plan.keptNonZero, [{ row: 8, month: '2026-09', envelope: '식료품', amount: 50, firstRow: 2 }]);
  assert.deepEqual(budgetDuplicateRows([]), { remove: [], keptNonZero: [] });
});
