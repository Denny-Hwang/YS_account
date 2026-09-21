# SHEET_SCHEMA.md — Google Sheet 탭과 열 정의

모든 데이터는 하나의 스프레드시트에 있다. 월별 탭은 만들지 않는다(ADR-0001).
헤더 행(1행)은 아래 표와 **글자 단위로 동일**해야 한다. `Config.js` 의 `SHEETS` 상수와 대조한다.
`extendable` 로 표시한 탭은 뒤쪽 열이 없을 때 `setupSheet()` 이 붙인다(데이터는 건드리지 않는다).

## Transactions (원장, append-only + soft delete)

| 열 | 설명 |
|---|---|
| id | `tx_` + 8자리 uuid 조각 |
| date | 거래일 YYYY-MM-DD |
| type | `income` \| `expense` \| `transfer` (저축 이동) |
| kind | `fixed` \| `variable` |
| category | 카테고리(주거비, 식료품, 외식, 교육비 …) |
| envelope | 유동비 세부예산 이름(Config.envelopes 중 하나). 고정비·수입·저축은 빈값 |

| merchant | 가맹점/상대 텍스트 |
| amount | 원래 통화 금액. **환불은 음수** |
| currency | `USD` \| `KRW` |
| amount_usd | USD 환산 금액(소수 둘째 자리). 환불은 음수 |
| recurring_id | Recurring.id 참조. 고정 항목과 건별 수입원(kind=variable) |
| status | `active` \| `expected` \| `committed` \| `confirmed` \| `deleted` (아래 표) |
| memo | 자유 메모. 환불은 `환불`, 같은 고정 항목의 두 번째 결제는 `이번 달 2번째` 가 들어간다 |
| payer | 기록한 사람 이름(또는 Telegram id) |
| source | `telegram` \| `web` \| `recurring` \| `csv` \| `migration` |
| created_at | ISO 8601 |
| updated_at | ISO 8601 |
| updated_by | 마지막 수정자 |

헤더 순서: `id, date, type, kind, category, envelope, merchant, amount, currency, amount_usd, recurring_id, status, memo, payer, source, created_at, updated_at, updated_by`

### 세부예산과 카테고리

두 열이 하는 일이 다르다.

| 열 | 부르는 이름 | 하는 일 |
|---|---|---|
| `envelope` | 세부예산 | 예산이 붙는 유동비 단위. 하루치·신호등·예산 화면이 이 열만 본다 |
| `category` | 카테고리 | 분류. 리포트에서 묶어 보는 데 쓴다. 고정비(주거비·통신비 …)도 여기에 들어간다 |

웹앱은 이 둘을 **한 칸**으로 보여 준다. 고른 이름이 `Config.envelopes` 에 있으면 두 열에 함께 쓰고,
없으면 `category` 에만 쓰고 `envelope` 은 비운다(`webapp/src/lib/ledger.ts` 의 `categoryFields`).
그래서 통신비를 골라도 유동비 예산이 흔들리지 않는다.

### status 다섯 가지

| 값 | 뜻 | 예산에 반영 | 집행 완료 |
|---|---|---|---|
| `active` | 봇·웹앱으로 기록한 유동비 | ○ | ○ |
| `confirmed` | 실제 금액이 들어온 고정 항목 | ○ | ○ |
| `committed` | 금액이 정해진 고정 항목. 달이 열릴 때 미리 잡는다(렌트·구독료·보험) | ○ | ✕ |
| `expected` | 금액을 모르는 예약(관리비·전기세·급여). 고지서나 입금을 봐야 안다 | ✕ | ✕ |
| `deleted` | 취소된 행. 물리적으로 지우지 않는다 | ✕ | ✕ |

`committed` 가 있는 이유는 착시를 막기 위해서다. 렌트가 아직 안 나갔다고 예산에서 빼지 않으면
달 초에는 늘 여유가 있어 보이고 말일에 갑자기 부족해진다. 금액이 정해진 것은 미리 뺀다.

집계 규칙:
- 예산·지출 합계는 `status ∈ {active, confirmed, committed}` 를 센다(`Budget.isSpentStatus`).
- 수입 합계는 실제로 들어온 `{active, confirmed}` 만 센다. 들어올 예정인 돈을 더하면 반대 방향의 착시가 생긴다.
- `expected` 는 금액이 정해지지 않아 어느 쪽에도 넣지 않는다. `deleted` 는 없는 것이다.

봇·웹앱·`Monthly_View`·`Dashboard` 가 모두 같은 기준을 쓴다. `transfer` 는 수입도 지출도 아니다.

## Recurring (고정 항목: 고정비 · 수입원 · 저축)

| 열 | 설명 |
|---|---|
| id | `R01`(고정비) / `I01`(수입원) / `S01`(저축) 형식 권장 |
| name | 항목 이름. 봇 메시지에 이 이름이 들어 있으면 사전에 없어도 잡힌다(kind=fixed 만) |
| kind | `fixed` \| `variable` |
| category | 카테고리 |
| expected_amount | 예상 금액(amount_rule 이 income_pct 면 수입이 없는 달의 대체값) |
| currency | `USD` \| `KRW` |
| due_day | 매월 결제일(1~31) |
| amount_rule | `fixed` \| `income_pct:N` (그 달 수입의 N%) \| `biweekly:M@YYYY-MM-DD` (2주급) |
| tolerance_pct | 예상 대비 허용 편차 % (월 마감 보고 기준) |
| active | `Y` \| `N` |
| notes | 메모 |
| type | `income` \| `expense` \| `transfer`. 비어 있으면 expense. `transfer` 는 "먼저 저축" 항목이다 |
| certainty | `fixed`(금액 확정) \| `variable`(금액 변동). 비어 있으면 아래 규칙으로 추론한다 |

헤더 순서: `id, name, kind, category, expected_amount, currency, due_day, amount_rule, tolerance_pct, active, notes, type, certainty` (extendable)

`certainty` 는 그 달 예약 행을 `committed` 로 만들지 `expected` 로 만들지 정한다
(`LedgerRules.recurringCertainty` / `initialRecurringStatus`). 비어 있을 때의 추론은 이렇다.

| 조건 | 결과 |
|---|---|
| `type` 가 `income` | `variable` — 들어와야 있는 돈이다 |
| `amount_rule` 이 `fixed` 가 아님(`income_pct`, `biweekly`) | `variable` — 달마다 계산이 달라진다 |
| `tolerance_pct` 가 0 | `fixed` — 금액이 정해진 항목이다 |
| 그 밖에 | `variable` |

`certainty` 를 바꾼 뒤 이미 만들어진 달을 맞추려면 `Recurring.gs` 의 `resyncReservedStatuses` 를 실행한다.
확정된(`confirmed`) 행과 실제 기록(`active`)은 건드리지 않는다.

`amount_rule` 규칙 (해석은 `LedgerRules.parseAmountRule`, 계산은 `expectedAmountFor`. 봇과 웹앱이 같은 함수를 쓴다):

| 값 | 그 달 예상 금액 |
|---|---|
| `fixed` | `expected_amount` 그대로 |
| `income_pct:N` | 그 달 수입 합 × N%. 아직 수입 기록이 없으면 `expected_amount` |
| `biweekly:M@YYYY-MM-DD` | 그 달 급여일 수 × M. `@` 뒤는 실제로 받은(또는 받을) 급여일 하나면 된다 |

2주급은 1년 26회라 대부분의 달은 2회, 두 달은 3회다. `biweekly` 는 기준 급여일에서 14일 간격으로 세어
그 달에 몇 번 들어오는지 자동으로 계산하므로, 3회 받는 달의 예상 수입이 저절로 1.5배가 된다.
예정 행도 그 달 **첫 급여일**에 만들어지고, 아침 요약의 "오늘 예정" 도 급여일마다 뜬다.
받을 때마다 봇에 `급여 2600` 을 보내면 첫 건은 예정 행을 확정하고 두 번째부터는 새 행이 쌓인다.

- `kind=fixed`: 매월 `expected` 행이 생기고, 봇에 "이름 금액" 을 보내면 그 행이 `confirmed` 로 바뀐다.
  이미 확정된 뒤 같은 이름을 또 보내면 **새 confirmed 행**이 추가된다(두 번째 주유, 두 번째 공과금). 덮어쓰지 않는다.
- `kind=variable`: 예약 행을 만들지 않는다. 건별 기록에 `recurring_id` 만 남아 합산된다(레슨 수입).
- `type=transfer`(저축): 고정비처럼 예정→확정으로 다루되 수입·지출 합계에 넣지 않는다. Today 화면의 "이달 저축" 이 이것이다.

## Budgets (월별 세부예산 예산)

| 열 | 설명 |
|---|---|
| month | YYYY-MM. **문자열**이어야 한다. 손으로 `2026-09` 를 치면 시트가 날짜로 바꾸므로 열 서식을 일반 텍스트로 둔다(`normalizeBudgetMonths`) |
| envelope | 세부예산 이름 |
| amount | 그 달 예산(USD) |
| carryover | `reset` \| `carry` (월말 잔액 처리) |

헤더 순서: `month, envelope, amount, carryover`

`month` 가 날짜로 저장돼 있어도 Apps Script(`Sheet.js` 의 `toMonthStr`)와 `Monthly_View` 수식(`TEXT(month,"yyyy-mm")`)은
같은 달로 읽는다. 웹앱은 Sheets API 의 표시 문자열을 받으므로 원래부터 영향이 없었다.

월 시작 규칙(`LedgerRules.nextMonthBudgets`):
- `carry` 세부예산은 전월 **양수** 잔액을 더한다. 음수는 더하지 않는다. 연간비 같은 싱킹 펀드는 `carry` 로 둔다.
- 어느 세부예산이든 전월 초과분(음수 잔액)의 합은 `Config.overspend_envelope`(기본 예비비)의 이번 달 금액에서 뺀다.
  식료품 예산을 생활 가능선 아래로 깎지 않으면서 초과가 공짜가 되지도 않게 하기 위해서다.
- 봇 명령 `이동 예비비→식료품 50` 과 빨강 회신의 버튼은 이번 달 두 행의 `amount` 를 옮긴다.

## Merchants (가맹점 사전)

| 열 | 설명 |
|---|---|
| keyword | 매칭 키워드(정규화 전 원문) |
| type | `income` \| `expense` \| `transfer` |
| kind | `fixed` \| `variable` |
| category | 카테고리 |
| envelope | 세부예산 |
| recurring_id | 고정 항목이면 Recurring.id |
| hit_count | 매칭 횟수 |
| last_used | 마지막 매칭 일시 |

헤더 순서: `keyword, type, kind, category, envelope, recurring_id, hit_count, last_used`

## Debts (부채)

| 열 | 설명 |
|---|---|
| id | `D01` 형식 |
| name | 부채 이름 |
| principal | 잔여 원금 |
| rate_pct | 연이율 % |
| monthly_payment | 월 상환액 |
| remaining_count | 남은 회차 |
| currency | `USD` \| `KRW` |
| notes | 메모 |
| recurring_id | 연결된 고정비 Recurring.id. 그 고정비가 확정되면 `principal −= 상환액 − 원금×이율/12`, `remaining_count −= 1` |

헤더 순서: `id, name, principal, rate_pct, monthly_payment, remaining_count, currency, notes, recurring_id` (extendable)

## Assets (자산 스냅샷)

| 열 | 설명 |
|---|---|
| snapshot_date | YYYY-MM-DD |
| account | 계좌/자산 이름 |
| balance | 잔액 |
| currency | `USD` \| `KRW` |
| fx_usd_krw | 스냅샷 당시 환율. KRW 행에만 의미가 있다. 비어 있으면 Config 값을 쓴다 |
| kind | 자산 종류(아래 표). 비어 있으면 `cash` 로 본다(이전 스냅샷과 호환) |

헤더 순서: `snapshot_date, account, balance, currency, fx_usd_krw, kind` (extendable)

| kind | 뜻 | 비상금에 포함 |
|---|---|---|
| `cash` | 계좌 잔액. 아무 때나 빼 쓸 수 있는 돈 | ○ |
| `stock` | 주식·펀드 등 투자 계좌 | ✕ |
| `pension` | 국민연금 | ✕ |
| `retirement` | 퇴직연금(IRP 등) | ✕ |
| `401k` | 미국 401k | ✕ |
| `hsa` | HSA | ✕ |
| `other` | 그 밖의 자산 | ✕ |

웹앱 자산 화면은 종류별로 묶어 보여 주고, 비상금(고정비 N개월치)은 `cash` 합계만으로 센다.
연금·401k 는 당장 쓸 수 없는 돈이라 비상금으로 치면 착시가 생기기 때문이다.
"새 스냅샷" 은 직전 스냅샷의 계좌 목록을 그대로 불러와 잔액만 고쳐 넣는 방식이라 매달 갱신이 빠르다.
같은 날짜에 이미 줄이 있으면 기본으로 그 줄들을 비우고 새 내용으로 바꾼다(두 벌 저장 방지).

자산 행 삭제는 **행을 지우지 않고 값을 비운다**(`webapp/src/lib/ledger.ts` 의 `removeRows`).
행 번호가 밀리면 같은 화면에서 이어지는 편집이 엉뚱한 행을 건드리기 때문이다. 빈 행은 읽을 때 걸러진다.
원장(`Transactions`)은 이 방식을 쓰지 않는다. 원장은 `status=deleted` 로만 지운다(Golden Rule 3).

## Goals (목표)

| 열 | 설명 |
|---|---|
| id | `G01` 형식 |
| horizon | `short` \| `mid` \| `long` |
| title | 목표 이름 |
| target_amount | 목표 금액 |
| deadline | YYYY-MM-DD |
| linked_envelope | 연결 세부예산(선택) |
| notes | 메모 |

헤더 순서: `id, horizon, title, target_amount, deadline, linked_envelope, notes`

비상금(고정비 N개월치)은 Goals 에 넣지 않아도 웹앱이 `Config.emergency_fund_months` 로 자동 계산해 목표 화면 맨 위에 보여 준다.

## Config (설정 key-value)

| 열 | 설명 |
|---|---|
| key | 설정 키 |
| value | 값 |

헤더 순서: `key, value`

필수 키(없으면 `setupSheet()` 이 기본값으로 넣는다):

| key | 기본값 | 설명 |
|---|---|---|
| fx_usd_krw | 1332 | KRW → USD 환산에 쓰는 환율 |
| envelopes | 식료품,생필품,예비비 | 유동비 세부예산 목록(콤마 구분). 외식은 식료품 세부예산에 넣되 카테고리는 `외식` |
| categories | 주거비,통신비,… | 예산이 붙지 않는 분류를 웹앱 목록에 미리 띄운다. 비워도 실제로 쓰인 분류는 저절로 오른다 |
| default_currency | USD | 통화 표기 없을 때 기본 통화 |
| timezone | America/Los_Angeles | 날짜 계산 기준 시간대. `appsscript.json` 의 timeZone 과 같아야 한다 |
| allowed_telegram_ids | (빈값) | 허용 Telegram user id(콤마 구분). 저장소에는 쓰지 않는다 |
| daily_summary_hour | 7 | 아침 요약 전송 시각(0~23) |
| income_hints | 수입,급여,입금 | 이 낱말이 있으면 수입으로 본다. 레슨 수입이 있으면 `레슨` 을 더한다 |
| overspend_envelope | 예비비 | 전월 초과분을 흡수하고, 빨강 회신 때 "여기서 옮기기" 버튼의 출처가 되는 세부예산 |
| emergency_fund_months | 3 | 비상금 목표 = 활성 고정비 월 합 × 이 값 |
| weekly_digest_day | 0 | 주간 결산을 보내는 요일. 0=일요일 … 6=토요일 |
| name_<telegram_id> | (선택) | 원장의 `payer` 에 넣을 사람 이름 |

`month_start_day` 는 더 이상 쓰지 않는다. 예산·가용액은 달력 월 기준이고 월 시작 트리거는 1일에 돈다.

## Log (수신 메시지 감사 로그)

| 열 | 설명 |
|---|---|
| timestamp | ISO 8601 |
| telegram_id | 발신자 id |
| raw_text | 원문 |
| parsed_json | 파서 결과 JSON. 분류·금액 버튼이 늦게 눌려 캐시가 비었을 때 여기서 복구한다 |
| result | 처리 결과 요약. `기록 tx_…`, `확정 tx_…`, `환불 tx_…`, `분류 대기`, `금액 확인`, `취소 tx_…` 등 |
| update_id | Telegram update.update_id. 재전송 중복 판별에 쓴다 |

헤더 순서: `timestamp, telegram_id, raw_text, parsed_json, result, update_id` (extendable)

버튼의 `callback_data` 는 `cls|<Log 행 번호>|<선택지 index>` 형식이라 Log 행이 대기 항목의 열쇠다.
Log 행을 지우면 그 행에 걸린 버튼은 "만료" 로 답한다.

## Monthly_View, Dashboard

수식 전용 탭. 데이터를 넣지 않는다. `Views.js`(P5) 가 지우고 다시 그린다.
합계는 `active`/`confirmed` 만 센다(웹앱과 같은 기준). 원장 목록에는 `expected` 도 보인다.
