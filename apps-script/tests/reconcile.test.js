const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, csvToObjects, reconcile, formatReconcileReport } = require('../src/ReconcileMatch.js');

test('CSV 는 따옴표 안의 콤마와 줄바꿈을 지킨다', () => {
  const text = 'date,desc,amount\n2026-09-02,"COSTCO WHSE, #123",85.89\n2026-09-03,"두 줄\n설명",12.00\n';
  const rows = parseCsv(text);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[1], ['2026-09-02', 'COSTCO WHSE, #123', '85.89']);
  assert.equal(rows[2][1], '두 줄\n설명');
});

test('CSV 는 "" 이스케이프를 따옴표 하나로 읽는다', () => {
  const rows = parseCsv('a,b\n1,"그가 ""안녕"" 이라 했다"\n');
  assert.equal(rows[1][1], '그가 "안녕" 이라 했다');
});

test('csvToObjects 는 헤더를 키로 쓴다', () => {
  const { headers, rows } = csvToObjects('날짜,내역,금액\n2026-09-02,코스트코,85.89\n');
  assert.deepEqual(headers, ['날짜', '내역', '금액']);
  assert.equal(rows[0]['내역'], '코스트코');
  assert.equal(rows[0]._line, 2);
});

const LEDGER = [
  { id: 'tx_1', date: '2026-09-02', type: 'expense', status: 'active', merchant: '코스트코', amount_usd: 85.89 },
  { id: 'tx_2', date: '2026-09-05', type: 'expense', status: 'active', merchant: '세이프웨이', amount_usd: 13.97 },
  { id: 'tx_3', date: '2026-09-06', type: 'expense', status: 'deleted', merchant: '취소된 건', amount_usd: 40 },
  { id: 'tx_4', date: '2026-09-07', type: 'income', status: 'active', merchant: '레슨', amount_usd: 400 },
  { id: 'tx_5', date: '2026-09-08', type: 'expense', status: 'active', merchant: '밤부마켓', amount_usd: 22.1 },
];

test('금액이 같고 날짜가 가까우면 맞춘다', () => {
  const r = reconcile(
    [{ date: '2026-09-03', description: 'COSTCO', amount: 85.89 }],
    LEDGER
  );
  assert.equal(r.matched.length, 1);
  assert.equal(r.matched[0].ledger.id, 'tx_1');
  assert.equal(r.matched[0].dayGap, 1);
});

test('창을 벗어나면 원장에 없음으로 본다', () => {
  const r = reconcile(
    [{ date: '2026-09-20', description: 'COSTCO', amount: 85.89 }],
    LEDGER,
    { windowDays: 3 }
  );
  assert.equal(r.matched.length, 0);
  assert.equal(r.missingInLedger.length, 1);
});

test('원장 행 하나는 명세서 한 건에만 쓰인다', () => {
  const r = reconcile(
    [
      { date: '2026-09-02', description: 'COSTCO A', amount: 85.89 },
      { date: '2026-09-02', description: 'COSTCO B', amount: 85.89 },
    ],
    LEDGER
  );
  assert.equal(r.matched.length, 1);
  assert.equal(r.missingInLedger.length, 1);
});

test('삭제된 행과 수입 행은 대조 대상이 아니다', () => {
  const r = reconcile([], LEDGER);
  const ids = r.ledgerOnly.map((row) => row.id);
  assert.ok(!ids.includes('tx_3'));
  assert.ok(!ids.includes('tx_4'));
  assert.deepEqual(ids, ['tx_1', 'tx_2', 'tx_5']);
});

test('날짜가 더 가까운 원장 행을 먼저 가져간다', () => {
  const ledger = [
    { id: 'far', date: '2026-09-01', type: 'expense', status: 'active', merchant: 'A', amount_usd: 50 },
    { id: 'near', date: '2026-09-04', type: 'expense', status: 'active', merchant: 'B', amount_usd: 50 },
  ];
  const r = reconcile([{ date: '2026-09-05', description: 'X', amount: 50 }], ledger);
  assert.equal(r.matched[0].ledger.id, 'near');
});

test('허용 오차 안의 금액 차이는 같은 것으로 본다', () => {
  const r = reconcile(
    [{ date: '2026-09-05', description: 'SAFEWAY', amount: 13.975 }],
    LEDGER,
    { tolerance: 0.01 }
  );
  assert.equal(r.matched.length, 1);
});

test('보고서에 세 가지 숫자가 모두 들어간다', () => {
  const r = reconcile([{ date: '2026-09-02', description: 'COSTCO', amount: 85.89 }], LEDGER);
  const text = formatReconcileReport(r);
  assert.match(text, /일치 1/);
  assert.match(text, /원장에 없음 0/);
  assert.match(text, /명세서에 없음 2/);
});
