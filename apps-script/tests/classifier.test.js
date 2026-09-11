const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, normalize } = require('../src/Classifier.js');

const MERCHANTS = [
  { keyword: '코스트코', type: 'expense', kind: 'variable', category: '식료품', envelope: '식료품', recurring_id: '', hit_count: 3 },
  { keyword: 'costco', type: 'expense', kind: 'variable', category: '식료품', envelope: '식료품', recurring_id: '', hit_count: 1 },
  { keyword: '세이프웨이', type: 'expense', kind: 'variable', category: '식료품', envelope: '식료품', recurring_id: '', hit_count: 0 },
  { keyword: '주유', type: 'expense', kind: 'fixed', category: '유류비', envelope: '', recurring_id: 'R06', hit_count: 0 },
  { keyword: '관리비', type: 'expense', kind: 'fixed', category: '주거비', envelope: '', recurring_id: 'R02', hit_count: 0 },
  { keyword: '레슨', type: 'income', kind: 'variable', category: '영주 레슨', envelope: '', recurring_id: '', hit_count: 5 }
];

test('normalize 는 소문자화하고 공백·기호를 제거한다', () => {
  assert.equal(normalize('  Cost-Co  '), 'costco');
  assert.equal(normalize('세이프웨이 #3'), '세이프웨이3');
  assert.equal(normalize('Safeway!'), 'safeway');
  assert.equal(normalize(null), '');
});

test('대소문자를 무시하고 매칭한다', () => {
  assert.equal(classify('COSTCO', MERCHANTS).keyword, 'costco');
  assert.equal(classify('CostCo', MERCHANTS).keyword, 'costco');
});

test('공백과 기호를 무시하고 매칭한다', () => {
  assert.equal(classify('세이프 웨이', MERCHANTS).keyword, '세이프웨이');
  assert.equal(classify('cost co', MERCHANTS).keyword, 'costco');
});

test('부분 일치도 매칭한다', () => {
  const r = classify('오늘 코스트코 다녀옴', MERCHANTS);
  assert.equal(r.keyword, '코스트코');
  assert.equal(r.envelope, '식료품');
});

test('고정비 사전은 recurring_id 를 돌려준다', () => {
  assert.equal(classify('주유소', MERCHANTS).recurring_id, 'R06');
  assert.equal(classify('9월 관리비', MERCHANTS).recurring_id, 'R02');
});

test('수입 사전은 type income 을 돌려준다', () => {
  const r = classify('레슨 윤지', MERCHANTS);
  assert.equal(r.type, 'income');
  assert.equal(r.category, '영주 레슨');
});

test('가장 긴 keyword 가 우선한다', () => {
  const rows = [
    { keyword: '마켓', envelope: '기타', hit_count: 99 },
    { keyword: '밤부마켓', envelope: '식료품', hit_count: 0 }
  ];
  assert.equal(classify('밤부마켓', rows).envelope, '식료품');
});

test('길이가 같으면 hit_count 가 큰 쪽이 우선한다', () => {
  const rows = [
    { keyword: '코스트코', envelope: '기타', hit_count: 1 },
    { keyword: '코스트코', envelope: '식료품', hit_count: 10 }
  ];
  assert.equal(classify('코스트코', rows).envelope, '식료품');
});

test('미매칭이면 null', () => {
  assert.equal(classify('처음보는가게', MERCHANTS), null);
  assert.equal(classify('', MERCHANTS), null);
  assert.equal(classify('코스트코', []), null);
  assert.equal(classify('코스트코', null), null);
});
