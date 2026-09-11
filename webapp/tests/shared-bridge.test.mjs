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
    '식료품 잔액 $804.98 · 남은 21일 × $38.33/일 · 계획 대비 +$138.31'
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
