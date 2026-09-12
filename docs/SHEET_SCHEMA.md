# SHEET_SCHEMA.md — Google Sheet 탭과 열 정의

모든 데이터는 하나의 스프레드시트에 있다. 월별 탭은 만들지 않는다(ADR-0001).
헤더 행(1행)은 아래 표와 **글자 단위로 동일**해야 한다. `Setup.js` 의 `SHEETS` 상수와 대조한다.

## Transactions (원장, append-only + soft delete)

| 열 | 설명 |
|---|---|
| id | `tx_` + 8자리 uuid 조각 |
| date | 거래일 YYYY-MM-DD |
| type | `income` \| `expense` \| `transfer` |
| kind | `fixed` \| `variable` |
| category | 카테고리(주거비, 식료품, 교육비 …) |
| envelope | 유동비 봉투 이름(Config.envelopes 중 하나). 고정비·수입은 빈값 가능 |
| merchant | 가맹점/상대 텍스트 |
| amount | 원래 통화 금액 |
| currency | `USD` \| `KRW` |
| amount_usd | USD 환산 금액(소수 둘째 자리) |
| recurring_id | Recurring.id 참조. 고정비만 |
| status | `active` \| `expected` \| `confirmed` \| `deleted` |
| memo | 자유 메모 |
| payer | 기록한 사람 이름(또는 Telegram id) |
| source | `telegram` \| `web` \| `recurring` \| `csv` \| `migration` |
| created_at | ISO 8601 |
| updated_at | ISO 8601 |
| updated_by | 마지막 수정자 |

헤더 순서: `id, date, type, kind, category, envelope, merchant, amount, currency, amount_usd, recurring_id, status, memo, payer, source, created_at, updated_at, updated_by`

## Recurring (고정비·정기 항목 정의)

| 열 | 설명 |
|---|---|
| id | `R01` 형식 |
| name | 항목 이름 |
| kind | `fixed` \| `variable` |
| category | 카테고리 |
| expected_amount | 예상 금액(amount_rule 이 income_pct 면 빈값 가능) |
| currency | `USD` \| `KRW` |
| due_day | 매월 결제일(1~31) |
| amount_rule | `fixed` \| `income_pct:N` (그 달 수입의 N%) |
| tolerance_pct | 예상 대비 허용 편차 % (월 마감 보고 기준) |
| active | `Y` \| `N` |
| notes | 메모 |

헤더 순서: `id, name, kind, category, expected_amount, currency, due_day, amount_rule, tolerance_pct, active, notes`

## Budgets (월별 봉투 예산)

| 열 | 설명 |
|---|---|
| month | YYYY-MM |
| envelope | 봉투 이름 |
| amount | 그 달 예산(USD) |
| carryover | `reset` \| `carry` (월말 잔액 처리) |

헤더 순서: `month, envelope, amount, carryover`

## Merchants (가맹점 사전)

| 열 | 설명 |
|---|---|
| keyword | 매칭 키워드(정규화 전 원문) |
| type | `income` \| `expense` \| `transfer` |
| kind | `fixed` \| `variable` |
| category | 카테고리 |
| envelope | 봉투 |
| recurring_id | 고정비면 Recurring.id |
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

헤더 순서: `id, name, principal, rate_pct, monthly_payment, remaining_count, currency, notes`

## Assets (자산 스냅샷)

| 열 | 설명 |
|---|---|
| snapshot_date | YYYY-MM-DD |
| account | 계좌/자산 이름 |
| balance | 잔액 |
| currency | `USD` \| `KRW` |

헤더 순서: `snapshot_date, account, balance, currency`

## Goals (목표)

| 열 | 설명 |
|---|---|
| id | `G01` 형식 |
| horizon | `short` \| `mid` \| `long` |
| title | 목표 이름 |
| target_amount | 목표 금액 |
| deadline | YYYY-MM-DD |
| linked_envelope | 연결 봉투(선택) |
| notes | 메모 |

헤더 순서: `id, horizon, title, target_amount, deadline, linked_envelope, notes`

## Config (설정 key-value)

| 열 | 설명 |
|---|---|
| key | 설정 키 |
| value | 값 |

헤더 순서: `key, value`

필수 키:

| key | 기본값 | 설명 |
|---|---|---|
| fx_usd_krw | 1332 | KRW → USD 환산에 쓰는 환율 |
| envelopes | 식료품,생필품,예비비 | 유동비 봉투 목록(콤마 구분). 외식은 식료품에 포함 |
| default_currency | USD | 통화 표기 없을 때 기본 통화 |
| timezone | America/Los_Angeles | 날짜 계산 기준 시간대 |
| allowed_telegram_ids | (빈값) | 허용 Telegram user id(콤마 구분). 저장소에는 쓰지 않는다 |
| daily_summary_hour | 7 | 아침 요약 전송 시각(0~23) |
| month_start_day | 1 | 월 시작일 |

## Log (수신 메시지 감사 로그)

| 열 | 설명 |
|---|---|
| timestamp | ISO 8601 |
| telegram_id | 발신자 id |
| raw_text | 원문 |
| parsed_json | 파서 결과 JSON |
| result | 처리 결과 요약 |
| update_id | Telegram update.update_id. 재전송 중복 판별에 쓴다 |

헤더 순서: `timestamp, telegram_id, raw_text, parsed_json, result, update_id`

`update_id` 는 나중에 추가된 열이라 `Log` 탭만 예외적으로 헤더 확장을 허용한다.
기존 시트에 이 열이 없으면 `setupSheet()` 이 마지막 열 뒤에 붙인다(데이터는 건드리지 않는다).
다른 탭은 헤더가 다르면 종전대로 오류를 낸다.

## Monthly_View, Dashboard

수식 전용 탭. 데이터를 넣지 않는다. `Views.js`(P5) 가 지우고 다시 그린다.
