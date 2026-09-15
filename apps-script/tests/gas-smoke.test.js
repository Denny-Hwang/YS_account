/**
 * GAS 전용 코드의 스모크 테스트.
 * SpreadsheetApp 등 구글 서비스를 인메모리로 흉내 내고 src/*.js 를 전부 한 스코프에 이어 붙여
 * 웹훅 흐름(기록 → 확정 → 두 번째 결제 → 취소 → 환불 → 이동 → 요약)을 실제로 돌린다.
 * 수식·차트·Drive·OCR 은 흉내 내지 않는다(Views/Receipt/Reconcile/Migration 은 호출하지 않는다).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** 인메모리 시트. 필요한 API 만 구현한다. */
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.frozen = 0; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(this.rows.length, 1000); }
  getMaxColumns() { return Math.max(this.getLastColumn(), 26); }
  setFrozenRows(n) { this.frozen = n; return this; }
  insertColumnsAfter() { return this; }
  insertRowsAfter() { return this; }
  clear() { this.rows = []; return this; }
  getCharts() { return []; }
  autoResizeColumns() { return this; }
  cell(r, c) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); return row; }
  appendRow(values) { this.rows.push(values.slice()); return this; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+)$/.exec(a);
      const col = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      return this.getRange(Number(m[2]), col, 1, 1);
    }
    const sheet = this; const r0 = a, c0 = b, nr = c || 1, nc = d || 1;
    return {
      getValues() { const out = []; for (let r = 0; r < nr; r++) { const row = []; for (let c = 0; c < nc; c++) { const src = sheet.rows[r0 - 1 + r] || []; row.push(src[c0 - 1 + c] === undefined ? '' : src[c0 - 1 + c]); } out.push(row); } return out; },
      getValue() { return this.getValues()[0][0]; },
      setValues(v) { v.forEach((row, r) => row.forEach((val, c) => { sheet.cell(r0 + r, c0 + c)[c0 + c - 1] = val; })); return this; },
      setValue(v) { sheet.cell(r0, c0)[c0 - 1] = v; return this; },
      setFormula() { return this; }, setFormulas() { return this; }, setFontWeight() { return this; },
      setNumberFormat() { return this; }, setDataValidation() { return this; }
    };
  }
  getDataRange() { return this.getRange(1, 1, Math.max(this.rows.length, 1), Math.max(this.getLastColumn(), 1)); }
}

function buildContext(options) {
  const sheets = {};
  const props = { SPREADSHEET_ID: 'demo', WEBHOOK_SECRET: 'secret', BOT_TOKEN: 'token' };
  const cache = new Map();
  const sent = [];
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = new Sheet(n)),
    getSheets: () => Object.values(sheets)
  };
  let uuid = 0;
  const ctx = {
    console,
    SpreadsheetApp: {
      openById: () => ss, getActiveSpreadsheet: () => ss, flush() {},
      newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } })
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: { createTextOutput: (t) => ({ text: t }) },
    Logger: { log() {} },
    Utilities: {
      getUuid: () => String(++uuid).padStart(8, '0') + '-uuid-x',
      formatDate: (d, tz, fmt) => {
        if (fmt === 'u') { const n = new Date(d.toLocaleString('en-US', { timeZone: tz })).getDay(); return String(n === 0 ? 7 : n); }
        const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
        return fmt === 'yyyy-MM' ? s.slice(0, 7) : s;
      },
      base64EncodeWebSafe: (s) => Buffer.from(s).toString('base64url')
    },
    UrlFetchApp: {
      fetch: (url, opt) => {
        const method = url.split('/').pop();
        const payload = JSON.parse(opt.payload || '{}');
        sent.push({ method, payload });
        const result = method === 'sendMessage' ? { message_id: sent.length } : true;
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ ok: true, result }) };
      }
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased() { return this; }, everyDays() { return this; }, atHour() { return this; }, onMonthDay() { return this; }, create() {} }) },
    Date: options && options.now ? class extends Date { constructor(...a) { super(...(a.length ? a : [options.now])); } static now() { return new Date(options.now).getTime(); } } : Date
  };
  ctx.sent = sent; ctx.sheets = sheets; ctx.cache = cache;
  vm.createContext(ctx);
  const dir = path.join(__dirname, '..', 'src');
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort().forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  return ctx;
}

function post(ctx, update) {
  return ctx.doPost({ parameter: { token: 'secret' }, postData: { contents: JSON.stringify(update) } });
}
let updateId = 100;
function msg(ctx, text, from) {
  return post(ctx, { update_id: ++updateId, message: { message_id: updateId, chat: { id: 1 }, from: { id: from || 11 }, text } });
}
function press(ctx, data, from) {
  const last = ctx.sent.filter((s) => s.method === 'sendMessage').slice(-1)[0];
  return post(ctx, { update_id: ++updateId, callback_query: { id: 'cq' + updateId, data, from: { id: from || 11 }, message: { message_id: ctx.sent.length, chat: { id: 1 }, text: last ? last.payload.text : '' } } });
}
const lastText = (ctx) => ctx.sent.filter((s) => s.method === 'sendMessage' || s.method === 'editMessageText').slice(-1)[0].payload.text;
const lastMarkup = (ctx) => ctx.sent.filter((s) => s.method === 'sendMessage' || s.method === 'editMessageText').slice(-1)[0].payload.reply_markup;
const rowsOf = (ctx, name) => ctx.readAll(name);

function fresh() {
  const ctx = buildContext({ now: '2026-09-13T20:00:00Z' });
  ctx.setupSheet(); ctx.seedRecurring(); ctx.seedMerchants();
  ctx.setConfig('allowed_telegram_ids', '11,22');
  ctx.setConfig('name_11', '아빠');
  ctx.applyBudgetAmounts('2026-09', { '식료품': 1000, '생필품': 100, '예비비': { amount: 100, carryover: 'carry' } });
  ctx.applyBudgetAmounts('2026-08', { '식료품': 1000, '생필품': 100, '예비비': { amount: 100, carryover: 'carry' } });
  ctx.postMonthlyRecurring('2026-09');
  ctx.invalidateReadCache();
  return ctx;
}

test('기록 → 회신은 신호등과 "오늘 남은" 으로 시작한다', () => {
  const ctx = fresh();
  msg(ctx, '코스트코 85.89');
  const tx = rowsOf(ctx, 'Transactions').filter((r) => r.merchant === '코스트코');
  assert.equal(tx.length, 1);
  assert.equal(tx[0].envelope, '식료품');
  assert.equal(tx[0].payer, '아빠');
  assert.match(lastText(ctx), /^🟢 식료품 오늘 남은 -?\$/);
});

test('고정 항목: 첫 결제는 expected 확정, 두 번째는 새 행 (H1)', () => {
  const ctx = fresh();
  msg(ctx, '관리비 212');
  let rows = rowsOf(ctx, 'Transactions').filter((r) => r.recurring_id === 'R02');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'confirmed');
  assert.equal(rows[0].amount, 212);
  assert.match(lastText(ctx), /관리비 \$212\.00 확정/);
  msg(ctx, '관리비 30');
  rows = rowsOf(ctx, 'Transactions').filter((r) => r.recurring_id === 'R02');
  assert.equal(rows.length, 2, '두 번째 결제는 새 행이어야 한다');
  assert.equal(rows[0].amount, 212, '첫 결제가 덮어써지면 안 된다');
  assert.equal(rows[1].amount, 30);
  assert.match(lastText(ctx), /이번 달 2번째/);
});

test('취소는 정확히 마지막 기록을 되돌린다 (H2)', () => {
  const ctx = fresh();
  msg(ctx, '코스트코 40');
  msg(ctx, '관리비 212');
  msg(ctx, '취소');
  const tx = rowsOf(ctx, 'Transactions');
  const costco = tx.find((r) => r.merchant === '코스트코');
  const mgmt = tx.find((r) => r.recurring_id === 'R02');
  assert.equal(costco.status, 'active', '코스트코가 지워지면 안 된다');
  assert.equal(mgmt.status, 'expected', '확정은 expected 로 돌아간다');
  assert.equal(mgmt.amount, 100, '금액도 원래 예상치로');
  assert.match(lastText(ctx), /확정을 되돌렸습니다/);
  msg(ctx, '취소');
  assert.equal(tx.find((r) => r.merchant === '코스트코').status, 'active');
  assert.equal(rowsOf(ctx, 'Transactions').find((r) => r.merchant === '코스트코').status, 'active', '두 번째 취소는 다른 행을 지우지 않는다');
  assert.match(lastText(ctx), /취소할 최근 기록이 없습니다/);
});

test('사전에 없는 가맹점: 버튼은 index 기반이고 늦게 눌러도(캐시 없음) Log 에서 복구된다 (M1)', () => {
  const ctx = fresh();
  msg(ctx, '처음가게 5');
  const markup = lastMarkup(ctx);
  const flat = markup.inline_keyboard.flat();
  assert.equal(flat[0].text, '식료품');
  assert.match(flat[0].callback_data, /^cls\|\d+\|0$/);
  assert.ok(flat.every((b) => Buffer.byteLength(b.callback_data) <= 64));
  ctx.cache.clear(); // 캐시 만료 상황
  press(ctx, flat[1].callback_data);
  const tx = rowsOf(ctx, 'Transactions').find((r) => r.merchant === '처음가게');
  assert.ok(tx, '캐시가 비어도 Log 에서 복구해 기록한다');
  assert.equal(tx.envelope, '생필품');
  assert.ok(rowsOf(ctx, 'Merchants').some((m) => m.keyword === '처음가게'), '사전에 학습된다');
  press(ctx, flat[1].callback_data);
  assert.equal(rowsOf(ctx, 'Transactions').filter((r) => r.merchant === '처음가게').length, 1, '두 번 눌러도 한 번만 기록된다 (M8)');
});

test('애매한 금액은 버튼으로 묻고, 확실한 후보는 바로 고른다 (M2)', () => {
  const ctx = fresh();
  msg(ctx, '코스트코 2병 5.99');
  assert.equal(rowsOf(ctx, 'Transactions').find((r) => r.merchant === '코스트코 2병').amount, 5.99);
  msg(ctx, '코스트코 2 3');
  assert.match(lastText(ctx), /금액이 어느 것인가요/);
  const buttons = lastMarkup(ctx).inline_keyboard.flat();
  assert.deepEqual(buttons.map((b) => b.text), ['$2.00', '$3.00']);
  press(ctx, buttons[0].callback_data);
  const tx = rowsOf(ctx, 'Transactions').filter((r) => r.merchant === '코스트코' && r.amount === 2);
  assert.equal(tx.length, 1);
});

test('환불은 같은 봉투의 음수 지출이고 잔액을 늘린다', () => {
  const ctx = fresh();
  msg(ctx, '코스트코 100');
  msg(ctx, '환불 코스트코 20');
  const tx = rowsOf(ctx, 'Transactions').filter((r) => /코스트코/.test(r.merchant));
  assert.equal(tx[1].amount, -20);
  assert.equal(tx[1].envelope, '식료품');
  assert.match(lastText(ctx), /↩︎ 환불 \$20\.00/);
  assert.match(lastText(ctx), /잔액 \$920\.00/);
});

test('봉투 초과는 빨강 + "예비비에서 옮기기" 버튼, 이동 명령은 예산을 옮긴다', () => {
  const ctx = fresh();
  msg(ctx, '다이소 130');
  assert.match(lastText(ctx), /^🔴 생필품/);
  const btn = lastMarkup(ctx).inline_keyboard[0][0];
  assert.match(btn.text, /^예비비에서 \$\d+\.00 옮기기$/);
  assert.equal(btn.text, '예비비에서 $30.00 옮기기'); // 초과 30 → 10 단위 올림
  press(ctx, btn.callback_data);
  assert.equal(ctx.getBudgetAmount('2026-09', '생필품'), 130);
  assert.equal(ctx.getBudgetAmount('2026-09', '예비비'), 70);
  msg(ctx, '이동 예비비→식료품 10');
  assert.equal(ctx.getBudgetAmount('2026-09', '식료품'), 1010);
  assert.equal(ctx.getBudgetAmount('2026-09', '예비비'), 60);
});

test('부채와 연결된 고정비를 확정하면 원금과 회차가 줄어든다', () => {
  const ctx = fresh();
  ctx.upsertRowById('Debts', { id: 'D02', name: '신용대출', principal: 5000, rate_pct: 12, monthly_payment: 500, remaining_count: 10, currency: 'USD', notes: '', recurring_id: 'R07' });
  ctx.invalidateReadCache();
  msg(ctx, '부채상환 500');
  const debt = rowsOf(ctx, 'Debts').find((d) => d.id === 'D02');
  assert.equal(debt.principal, 4550); // 이자 50, 원금 450
  assert.equal(debt.remaining_count, 9);
  assert.match(lastText(ctx), /신용대출 원금 \$4,550\.00/);
});

test('저축(transfer)은 예정→확정이고 수입·지출 합계에 들어가지 않는다', () => {
  const ctx = fresh();
  msg(ctx, '저축 300');
  const row = rowsOf(ctx, 'Transactions').find((r) => r.recurring_id === 'S01');
  assert.equal(row.status, 'confirmed');
  assert.equal(row.type, 'transfer');
  assert.match(lastText(ctx), /✓ 저축 \$300\.00 확정/);
  const totals = ctx.monthTotals('2026-09'); // vm 컨텍스트의 객체라 deepEqual 대신 필드로 비교한다
  assert.equal(totals.income, 0);
  assert.equal(totals.expense, 0);
  assert.equal(ctx.savingsPlan('2026-09').actual, 300);
});

test('아침 요약은 전부 초록이면 한 줄, 아니면 문제 봉투만 길게', () => {
  const ctx = fresh();
  let text = ctx.dailySummary();
  assert.match(text, /🟢 전 봉투 계획 안 · 오늘 \$/);
  assert.match(text, /💰 저축 \$0\.00 \/ \$300\.00/);
  msg(ctx, '다이소 130');
  text = ctx.dailySummary();
  assert.match(text, /🔴 생필품 오늘 남은/);
  assert.match(text, /🟢 식료품 오늘 \$/);
  assert.ok(!/전 봉투 계획 안/.test(text));
});

test('월 마감 점수와 주간 결산이 만들어진다', () => {
  const ctx = fresh();
  msg(ctx, '급여 3000');
  msg(ctx, '코스트코 400');
  const report = ctx.buildMonthlyCloseReport('2026-09', '2026-09-30', false);
  assert.match(report, /점수 · 저축률 87% \(지난달 -\) · 예산 안 3\/3 봉투/);
  ctx.setConfig('weekly_digest_day', String(new Date(new Date('2026-09-13T20:00:00Z').toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })).getDay()));
  const weekly = ctx.weeklyDigest();
  assert.match(weekly, /📈 주간 결산/);
  assert.match(weekly, /유동비 \$400\.00/);
});

test('월 시작: carry 는 양수만 이월하고 초과분은 예비비에서 뺀다. ensureMonthOpened 가 보정한다', () => {
  const ctx = fresh();
  // 8월: 식료품 80 초과, 예비비 60 남음
  ctx.appendRow('Transactions', { id: 'tx_aug1', date: '2026-08-10', type: 'expense', kind: 'variable', category: '식료품', envelope: '식료품', merchant: 'a', amount: 1080, currency: 'USD', amount_usd: 1080, status: 'active', source: 'web' });
  ctx.appendRow('Transactions', { id: 'tx_aug2', date: '2026-08-11', type: 'expense', kind: 'variable', category: '예비비', envelope: '예비비', merchant: 'b', amount: 40, currency: 'USD', amount_usd: 40, status: 'active', source: 'web' });
  // 9월 예산 행을 지운 상태를 흉내 낸다: 새 시트에서 10월을 연다
  const opened = ctx.openMonthBudgets('2026-10');
  assert.equal(opened.added, 3);
  assert.equal(ctx.getBudgetAmount('2026-10', '식료품'), 1000);
  // 9월 기준으로 10월을 열었으므로 9월 잔액이 기준이다(9월 지출 없음): 예비비 100 + 100 이월
  assert.equal(ctx.getBudgetAmount('2026-10', '예비비'), 200);
  assert.equal(ctx.ensureMonthOpened('2026-11'), true);
  assert.equal(ctx.getBudgetAmount('2026-11', '식료품'), 1000);
  assert.ok(rowsOf(ctx, 'Transactions').some((r) => r.date === '2026-11-01' && r.status === 'expected'));
});

test('허용되지 않은 발신자와 틀린 token 은 아무것도 하지 않는다', () => {
  const ctx = fresh();
  const before = rowsOf(ctx, 'Transactions').length;
  msg(ctx, '코스트코 10', 99);
  ctx.doPost({ parameter: { token: 'wrong' }, postData: { contents: JSON.stringify({ update_id: 1, message: { chat: { id: 1 }, from: { id: 11 }, text: '코스트코 10' } }) } });
  assert.equal(rowsOf(ctx, 'Transactions').length, before);
});

test('2주급 급여: 3번 받는 달은 예상이 1.5배, 받을 때마다 행이 쌓인다', () => {
  const ctx = fresh();
  // 시드의 급여를 2주급 규칙으로 바꾼다. 1회 2600, 기준 급여일 2026-01-02.
  ctx.updateRowById('Recurring', 'I01', { amount_rule: 'biweekly:2600@2026-01-02', expected_amount: 5200 });
  ctx.invalidateReadCache();
  const salary = ctx.readAll('Recurring').find((r) => r.id === 'I01');

  // 2026-09 는 11일과 25일 두 번, 2026-07 은 세 번이다.
  assert.equal(ctx.recurringExpectedAmount(salary, '2026-09'), 5200);
  assert.equal(ctx.recurringExpectedAmount(salary, '2026-07'), 7800);

  // 예정 행은 그 달 첫 급여일에 만들어진다.
  ctx.postMonthlyRecurring('2026-10');
  const oct = ctx.readAll('Transactions').filter((r) => r.recurring_id === 'I01' && String(r.date).slice(0, 7) === '2026-10');
  assert.equal(oct.length, 1);
  assert.equal(oct[0].date, '2026-10-09');
  assert.equal(oct[0].amount, 5200);

  // 이번 달(2026-09) 급여를 두 번 받으면 두 행이 남는다. 첫 건이 덮어써지지 않는다.
  msg(ctx, '급여 2600');
  msg(ctx, '급여 2600');
  const sep = ctx.readAll('Transactions').filter((r) => r.recurring_id === 'I01' && String(r.date).slice(0, 7) === '2026-09');
  assert.equal(sep.length, 2);
  assert.equal(sep.filter((r) => String(r.status) === 'confirmed').length, 2);
  assert.equal(sep.reduce((a, r) => a + Number(r.amount_usd), 0), 5200);
  assert.match(lastText(ctx), /이번 달 2번째/);
});

test('지난달 지출을 뒤늦게 기록하면 그 달 기준으로 결산해 회신한다', () => {
  const ctx = fresh();
  msg(ctx, '2026-08-28 코스트코 190.05');
  const row = rowsOf(ctx, 'Transactions').find((r) => r.date === '2026-08-28');
  assert.equal(row.envelope, '식료품');
  assert.equal(row.amount, 190.05);
  const text = lastText(ctx);
  assert.match(text, /✓ 2026-08 식료품 \$190\.05 기록/);
  assert.match(text, /2026-08 실행 \$190\.05 \/ 예산 \$1,000\.00 · 잔액 \$809\.95/);
  assert.ok(!/오늘 남은/.test(text), '지난달 기록에 "오늘 남은" 은 뜻이 없다');
  // 이번 달 봉투 상태는 지난달 기록에 영향받지 않는다
  msg(ctx, '코스트코 10');
  assert.match(lastText(ctx), /^🟢 식료품 오늘 남은/);
});

test('이번 달 지난 날짜는 평소대로 오늘 기준 한 줄로 회신한다', () => {
  const ctx = fresh();
  msg(ctx, '9/6 코스트코 85.89');
  assert.equal(rowsOf(ctx, 'Transactions').find((r) => r.merchant === '코스트코').date, '2026-09-06');
  assert.match(lastText(ctx), /^🟢 식료품 오늘 남은 \$/);
});

test('허용되지 않은 telegram id 는 조용히 버리지 않고 Log 에 id 를 남긴다', () => {
  const ctx = fresh();
  msg(ctx, '코스트코 40', 99);
  assert.equal(rowsOf(ctx, 'Transactions').filter((r) => r.merchant === '코스트코').length, 0,
    '허용되지 않은 사람의 기록은 남지 않는다');
  assert.equal(ctx.sent.filter((s) => s.method === 'sendMessage').length, 0, '회신도 가지 않는다');
  const tail = rowsOf(ctx, 'Log').slice(-1)[0];
  assert.match(String(tail.result), /거부: Config\.allowed_telegram_ids 에 없는 id \(99\)/);
  assert.equal(String(tail.telegram_id), '99', '넣어야 할 id 를 그대로 남긴다');
});

test('token 이 틀리면 한 시간에 한 줄만 Log 에 남긴다', () => {
  const ctx = fresh();
  const before = rowsOf(ctx, 'Log').length;
  const bad = { parameter: { token: 'wrong' }, postData: { contents: JSON.stringify({ update_id: 1, message: { message_id: 1, chat: { id: 1 }, from: { id: 11 }, text: '코스트코 40' } }) } };
  ctx.doPost(bad);
  ctx.doPost(bad);
  const rows = rowsOf(ctx, 'Log');
  assert.equal(rows.length, before + 1, '반복 호출에도 한 줄만 쌓인다');
  assert.match(String(rows.slice(-1)[0].result), /token 불일치/);
  assert.equal(rowsOf(ctx, 'Transactions').filter((r) => r.merchant === '코스트코').length, 0);
});

test('diagnoseWebhook 은 비밀값을 가리고 원인 후보를 찍는다', () => {
  const ctx = fresh();
  const printed = [];
  ctx.Logger.log = (s) => printed.push(String(s));
  ctx.PropertiesService.getScriptProperties().setProperty('WEBAPP_URL',
    'https://script.google.com/macros/s/demo-deploy-id-abcdef/exec');
  ctx.diagnoseWebhook();
  const out = printed.join('\n');
  assert.ok(!/secret/.test(out), 'WEBHOOK_SECRET 값이 그대로 찍히면 안 된다');
  assert.ok(!/demo-deploy-id-abcdef/.test(out), '배포 URL 전체가 찍히면 안 된다');
  assert.match(out, /allowed_telegram_ids: 11, 22/);
  assert.match(out, /최근 Log 10줄/);
});
