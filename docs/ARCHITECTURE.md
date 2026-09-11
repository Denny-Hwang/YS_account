# ARCHITECTURE.md — family-budget

## 계층별 역할과 하지 않는 것

### Telegram 봇
- 역할: 가족 구성원이 스마트폰에서 "코스트코 85.89" 같은 한 줄을 보내는 **입력 창구**다.
- 입력 최소화가 목표다. 날짜·통화·봉투를 매번 적지 않아도 파서와 사전이 채운다.
- 미분류 가맹점은 inline 버튼으로 봉투를 고르게 하고, 그 선택을 사전(`Merchants`)에 학습시킨다.
- 회신은 "이 봉투에 오늘 얼마 남았는지" 한 줄 수준으로만 한다.
- 하지 않는 것: 봇 자체에는 상태·데이터가 없다. 고정비·부채·자산·목표 같은 민감 정보는 회신하지 않는다.
- 하지 않는 것: 봇이 원장을 편집하는 UI 가 되지 않는다. 편집은 웹앱(또는 시트)에서 한다.

### Google Apps Script (GAS)
- 역할: Telegram 웹훅(`doPost`)을 받아 파싱 → 분류 → 원장 기록 → 회신까지 처리하는 **유일한 서버**다.
- 시간 트리거로 매월 고정비 자동 기장, 매일 아침 요약, 월 마감 요약을 수행한다.
- 파서·분류·예산 계산은 Google 서비스에 의존하지 않는 순수 모듈로 분리해 Node 에서 단위 테스트한다.
- 비밀값은 전부 Script Properties 에서만 읽는다.
- 하지 않는 것: 금액·날짜 추출에 LLM 을 쓰지 않는다(규칙 기반만). 원장 행을 물리 삭제하지 않는다.
- 하지 않는 것: 요청 헤더 기반 인증(Apps Script 가 헤더를 읽지 못하므로 URL 파라미터로 검증).

### Google Sheet
- 역할: **단일 원장(`Transactions`)과 참조 테이블**(Recurring, Budgets, Merchants, Debts, Assets, Goals, Config, Log)을 담는 유일한 저장소다.
- 시트 공유 권한이 곧 접근 권한이다. 별도 사용자 테이블을 두지 않는다.
- `Monthly_View`, `Dashboard` 탭은 수식 전용이며 데이터를 갖지 않는다.
- 사람이 직접 셀을 고쳐도 되지만, 원장 삭제는 `status=deleted` 로만 한다.
- 하지 않는 것: 월별 탭을 만들지 않는다(ADR-0001). 백엔드 로직을 시트 수식에 넣지 않는다(집계 표시만).

### PWA 웹앱 (GitHub Pages, P7 이후)
- 역할: "오늘 쓸 수 있는 돈" 화면과 원장 편집 화면을 제공하는 **읽기·편집 프런트엔드**다.
- Google Identity Services 로 로그인하고 Sheets API v4 로 시트를 직접 읽고 쓴다. 별도 백엔드 없음.
- 시트에 편집 권한이 있는 계정만 데이터를 볼 수 있다(시트 공유 = 접근 권한).
- 하지 않는 것: 자체 DB·세션 저장소를 두지 않는다. 비밀값을 번들에 포함하지 않는다(OAuth client id 는 공개값).
- 하지 않는 것: P7 전까지는 `webapp/` 을 비워 둔다.

## 데이터 흐름: 메시지 → doPost → 파서 → 사전 조회 → 기록 → 회신
1. 사용자가 Telegram 봇에 텍스트를 보낸다. Telegram 이 `WEBAPP_URL?token=<WEBHOOK_SECRET>` 로 POST 한다.
2. `doPost(e)` 는 **가장 먼저** `e.parameter.token` 을 Script Properties 의 `WEBHOOK_SECRET` 과 비교한다. 불일치면 조용히 200 을 돌려준다.
3. 발신자 Telegram user id 가 `Config.allowed_telegram_ids` 에 없으면 무시한다(회신도 없음).
4. 원문을 `Log` 탭에 먼저 기록한다(raw_text). 이후 어떤 예외가 나도 추적 가능하게 한다.
5. `Parser.parseMessage(text, ctx)` 가 의도(record/query/undo/unknown), 금액, 통화, 날짜, 가맹점 텍스트를 규칙 기반으로 추출한다.
6. `Classifier.classify(merchantText, merchants)` 가 `Merchants` 사전에서 최장 일치 keyword 를 찾아 type/kind/category/envelope/recurring_id 를 결정한다.
7. 매칭되면 `Ledger.recordTransaction` 이 `Transactions` 에 append 한다(append-only). recurring_id 가 있으면 이번 달 `expected` 행을 `confirmed` 로 갱신한다.
8. 미매칭이면 봉투 선택 inline 버튼을 보내고, 콜백에서 `Merchants` 에 학습 후 기록한다.
9. `Budget.envelopeStatus` 로 해당 봉투의 잔액과 오늘 가용액을 계산해 한 줄로 회신한다.
10. `Log` 탭의 해당 행에 parsed_json 과 result 를 남긴다.

## 보안 경계
- **시트 공유 = 접근 권한.** 데이터를 볼 수 있는 사람은 Google Sheet 에 편집자로 공유된 계정뿐이다. 웹앱도 이 권한을 그대로 쓴다.
- **웹훅 인증.** Apps Script `doPost` 는 요청 헤더를 읽을 수 없으므로 배포 URL 뒤에 `?token=<WEBHOOK_SECRET>` 을 붙여 등록하고, 이 파라미터를 첫 번째 검사로 비교한다. URL 을 모르면 아무것도 할 수 없다.
- **허용 Telegram ID.** token 이 맞아도 `Config.allowed_telegram_ids` 에 없는 발신자는 무시한다. 봇을 아무나 찾아도 기록할 수 없다.
- **비밀값은 Script Properties 에만.** `BOT_TOKEN`, `WEBHOOK_SECRET`, `SPREADSHEET_ID`, `WEBAPP_URL` 은 저장소에 절대 쓰지 않는다. `.clasp.json` 은 .gitignore 대상이고 예시는 `.example` 로만 둔다.
- **봇 회신 범위 제한.** 봇은 유동비 봉투 잔액까지만 회신한다. 고정비 상세, 부채, 자산, 목표는 회신하지 않는다. 채팅이 유출돼도 피해 범위를 줄인다.
- **감사 추적.** 모든 수신 메시지는 `Log` 에 남고, 원장은 soft delete 만 허용하므로 누가 언제 무엇을 바꿨는지 `updated_by`/`updated_at` 로 추적된다.

## 롤링 일일 가용액 정의
- 정의: `allowance_today = (budget − spent_before_today) / remaining_days_incl_today`
- `budget`: 해당 월·봉투의 `Budgets.amount`(carryover=carry 면 전월 잔액 가산분 포함).
- `spent_before_today`: 그 달 오늘 이전 날짜의 `type=expense, kind=variable, status∈{active,confirmed}` 행의 `amount_usd` 합.
- `remaining_days_incl_today`: 오늘을 포함해 그 달 말일까지 남은 일수.
- 어제 덜 썼으면 오늘 가용액이 올라가고, 더 썼으면 내려간다. 매일 아침 다시 계산되므로 "오늘 이 봉투에서 이만큼 써도 된다"가 항상 현재 잔액 기준이다.
- 예: 9/10, 예산 $1000, 오늘 이전 지출 $195.02 → 남은 21일 → 가용액 $38.33/일.
- 예산 초과 시 음수가 될 수 있으며 그대로 표시한다(숨기지 않는다).
- 보조 지표: `plannedPaceToDate = budget × (dayOfMonth / daysInMonth)`, `deltaVsPlan = plannedPaceToDate − spentTotal`.
