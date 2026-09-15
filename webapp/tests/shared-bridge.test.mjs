import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { sharedDir, toEsm } from '../scripts/gas-shared.mjs'

/**
 * 웹앱은 Apps Script 의 순수 모듈을 빌드 시 ESM 으로 바꿔서 쓴다.
 * 그 변환이 깨지면 봇과 웹앱의 계산이 갈라지므로 여기서 실제로 불러와 확인한다.
 */
async function loadShared(fileName) {
  const source = fs.readFileSync(path.join(sharedDir, fileName), 'utf8')
  const esm = toEsm(source)
  assert.ok(esm, `${fileName} 에서 내보낼 함수를 찾지 못했습니다`)
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gas-shared-')), fileName.replace('.js', '.mjs'))
  fs.writeFileSync(tmp, esm)
  return import(pathToFileURL(tmp).href)
}

test('Budget.js 를 ESM 으로 불러와 봇과 같은 값을 낸다', async () => {
  const budget = await loadShared('Budget.js')
  const status = budget.envelopeStatus({
    budget: 1000,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [
      { date: '2026-09-02', type: 'expense', kind: 'variable', status: 'active', envelope: '식료품', amount_usd: 195.02 },
    ],
  })
  assert.equal(status.remainingDays, 21)
  assert.equal(status.allowanceToday, 38.33)
  assert.equal(
    budget.formatStatusLine(status, '식료품'),
    '🟢 식료품 오늘 남은 $38.33 · 하루치 $38.33 · 잔액 $804.98 · 계획 대비 +$138.31'
  )
})

test('Parser.js 를 ESM 으로 불러와 금액을 읽는다', async () => {
  const parser = await loadShared('Parser.js')
  const parsed = parser.parseMessage('코스트코 85.89', {
    today: '2026-09-10',
    defaultCurrency: 'USD',
    fxUsdKrw: 1332,
  })
  assert.equal(parsed.intent, 'record')
  assert.equal(parsed.amount, 85.89)
  assert.equal(parsed.merchantText, '코스트코')
})

test('Classifier.js 를 ESM 으로 불러와 사전을 조회한다', async () => {
  const classifier = await loadShared('Classifier.js')
  const hit = classifier.classify('오늘 코스트코 다녀옴', [
    { keyword: '코스트코', envelope: '식료품', hit_count: 1 },
  ])
  assert.equal(hit.envelope, '식료품')
})

test('LedgerRules.js 를 ESM 으로 불러와 확정 대상과 상각을 계산한다', async () => {
  const rules = await loadShared('LedgerRules.js')
  const pick = rules.pickConfirmTarget(
    [{ id: 'a', recurring_id: 'R06', status: 'confirmed' }, { id: 'b', recurring_id: 'R02', status: 'expected' }],
    'R06'
  )
  assert.equal(pick.target, null)
  assert.equal(pick.confirmedCount, 1)
  assert.equal(rules.amortizeOnce(10000, 12, 500).newPrincipal, 9600)
  assert.equal(rules.payoffMonths(1000, 0, 100), 10)
})

test('Budget.js 의 allowanceLeftToday 는 오늘 쓴 만큼 줄어든다', async () => {
  const budget = await loadShared('Budget.js')
  const status = budget.envelopeStatus({
    budget: 1000,
    envelope: '식료품',
    today: '2026-09-10',
    transactions: [
      { date: '2026-09-02', type: 'expense', kind: 'variable', status: 'active', envelope: '식료품', amount_usd: 195.02 },
      { date: '2026-09-10', type: 'expense', kind: 'variable', status: 'active', envelope: '식료품', amount_usd: 20 },
    ],
  })
  assert.equal(status.allowanceToday, 38.33)
  assert.equal(status.allowanceLeftToday, 18.33)
  assert.equal(status.signal, 'green')
})

test('LedgerRules.js 의 2주급 규칙을 웹앱에서도 같은 값으로 읽는다', async () => {
  const rules = await loadShared('LedgerRules.js')
  assert.deepEqual(rules.parseAmountRule('biweekly:2600@2026-01-02'), {
    type: 'biweekly',
    perCheck: 2600,
    anchor: '2026-01-02',
  })
  assert.equal(rules.biweeklyPaydays('2026-01', '2026-01-02').length, 3)
  assert.equal(rules.biweeklyPaydays('2026-02', '2026-01-02').length, 2)
  const salary = { expected_amount: 5200, amount_rule: 'biweekly:2600@2026-01-02' }
  assert.equal(rules.expectedAmountFor(salary, '2026-01', 0), 7800)
  assert.equal(rules.expectedAmountFor(salary, '2026-02', 0), 5200)
})

test('금액 확정 고정비는 committed 로 잡히고 예산에 반영된다', async () => {
  const rules = await loadShared('LedgerRules.js')
  const budget = await loadShared('Budget.js')

  // 금액이 정해진 것: tolerance 0, amount_rule=fixed, 지출
  const rent = { type: 'expense', amount_rule: 'fixed', tolerance_pct: 0 }
  assert.equal(rules.recurringCertainty(rent), 'fixed')
  assert.equal(rules.initialRecurringStatus(rent), 'committed')

  // 고지서를 받아야 아는 것
  const utility = { type: 'expense', amount_rule: 'fixed', tolerance_pct: 15 }
  assert.equal(rules.recurringCertainty(utility), 'variable')
  assert.equal(rules.initialRecurringStatus(utility), 'expected')

  // 수입과 계산식 항목은 들어와 봐야 안다
  assert.equal(rules.recurringCertainty({ type: 'income', amount_rule: 'fixed', tolerance_pct: 0 }), 'variable')
  assert.equal(rules.recurringCertainty({ type: 'expense', amount_rule: 'income_pct:10', tolerance_pct: 0 }), 'variable')

  // certainty 열을 직접 적으면 그 값이 이긴다
  assert.equal(rules.recurringCertainty({ ...utility, certainty: 'fixed' }), 'fixed')
  assert.equal(rules.recurringCertainty({ ...rent, certainty: 'variable' }), 'variable')

  // committed 는 예산에 들어가고 expected 는 들어가지 않는다
  assert.equal(budget.isSpentStatus('committed'), true)
  assert.equal(budget.isSpentStatus('expected'), false)
  assert.equal(budget.isSettledStatus('committed'), false)
  assert.equal(rules.isReservedStatus('committed'), true)
  assert.equal(rules.isReservedStatus('confirmed'), false)
})

test('committed 예약 행도 확정 대상이고 되돌리면 committed 로 돌아간다', async () => {
  const rules = await loadShared('LedgerRules.js')
  const pick = rules.pickConfirmTarget(
    [{ id: 'a', recurring_id: 'R01', status: 'committed' }],
    'R01'
  )
  assert.equal(pick.target.id, 'a')
  const plan = rules.undoPlan(
    { id: 'a', status: 'confirmed', source: 'recurring' },
    { mode: 'confirm', previous: { amount: 1000, status: 'committed' } },
    null
  )
  assert.equal(plan.action, 'revert')
  assert.equal(plan.patch.status, 'committed')
})
