# ARCHITECTURE.md — family-budget

## 계층별 역할과 하지 않는 것

### Telegram 봇
- 역할: 가족 구성원이 스마트폰에서 "코스트코 85.89" 같은 한 줄을 보내는 **입력 창구**다.
- 입력 최소화가 목표다. 날짜·통화·세부예산을 매번 적지 않아도 파서와 사전이 채운다.
- 미분류 가맹점은 inline 버튼으로 세부예산을 고르게 하고, 그 선택을 사전(`Merchants`)에 학습시킨다.
- 회신은 신호등 한 글자와 "지금 남은 오늘치" 를 앞에 둔 한 줄이다. 빨강이면 "예비비에서 옮기기" 버튼이 붙는다.
- 하지 않는 것: 봇 자체에는 상태·데이터가 없다. 고정비 상세·부채·자산·목표 같은 민감 정보는 회신하지 않는다.
- 하지 않는 것: 봇이 원장을 편집하는 UI 가 되지 않는다. 편집은 웹앱(또는 시트)에서 한다. "취소" 만 예외다.

### Google Apps Script (GAS)
- 역할: Telegram 웹훅(`doPost`)을 받아 파싱 → 분류 → 원장 기록 → 회신까지 처리하는 **유일한 서버**다.
- 시간 트리거로 매월 고정 항목 자동 기장, 매일 아침 요약, 주간 결산, 월 마감 요약을 수행한다.
- 파서·분류·예산 계산·원장 규칙은 Google 서비스에 의존하지 않는 순수 모듈로 분리해 Node 에서 단위 테스트한다.
  `Budget.js`, `Parser.js`, `Classifier.js`, `LedgerRules.js`, `Dedupe.js`, `MigrationMap.js`, `ReconcileMatch.js`.
- 비밀값은 전부 Script Properties 에서만 읽는다.
- 하지 않는 것: 금액·날짜 추출에 LLM 을 쓰지 않는다(규칙 기반만). 원장 행을 물리 삭제하지 않는다.
- 하지 않는 것: 요청 헤더 기반 인증(Apps Script 가 헤더를 읽지 못하므로 URL 파라미터로 검증).

### Google Sheet
- 역할: **단일 원장(`Transactions`)과 참조 테이블**(Recurring, Budgets, Merchants, Debts, Assets, Goals, Config, Log)을 담는 유일한 저장소다.
- 시트 공유 권한이 곧 접근 권한이다. 별도 사용자 테이블을 두지 않는다.
- `Monthly_View`, `Dashboard` 탭은 수식 전용이며 데이터를 갖지 않는다. 합계는 웹앱과 같은 기준(active/confirmed)이다.
- 사람이 직접 셀을 고쳐도 되지만, 원장 삭제는 `status=deleted` 로만 한다.
- 하지 않는 것: 월별 탭을 만들지 않는다(ADR-0001). 백엔드 로직을 시트 수식에 넣지 않는다(집계 표시만).

### PWA 웹앱 (GitHub Pages)
- 역할: "오늘 남은 돈" 화면과 원장 편집 화면을 제공하는 **읽기·편집 프런트엔드**다.
- Google Identity Services 로 로그인하고 Sheets API v4 로 시트를 직접 읽고 쓴다. 별도 백엔드 없음.
- 시트에 편집 권한이 있는 계정만 데이터를 볼 수 있다(시트 공유 = 접근 권한).
- 계산 코드는 `apps-script/src` 의 순수 모듈을 빌드 시 ESM 으로 바꿔 그대로 쓴다. 빠른 입력의 고정 항목 확정도 봇과 같은 규칙(`LedgerRules.pickConfirmTarget`)이다.
- 쓰기는 바뀐 셀만 쓴다(`values:batchUpdate`). 그 사이 다른 사람이 고친 열을 되돌리지 않는다.
- 하지 않는 것: 자체 DB·세션 저장소를 두지 않는다. 비밀값을 번들에 포함하지 않는다(OAuth client id 는 공개값).

## 데이터 흐름: 메시지 → doPost → 파서 → 사전 조회 → 기록 → 회신
1. 사용자가 Telegram 봇에 텍스트를 보낸다. Telegram 이 `WEBAPP_URL?token=<WEBHOOK_SECRET>` 로 POST 한다.
2. `doPost(e)` 는 **가장 먼저** `e.parameter.token` 을 Script Properties 의 `WEBHOOK_SECRET` 과 비교한다. 불일치면 조용히 200 을 돌려준다.
3. `update_id` 를 잠금 안에서 캐시에 적어 같은 update 를 두 번 처리하지 않는다(P3.1).
4. 발신자 Telegram user id 가 `Config.allowed_telegram_ids` 에 없으면 무시한다(회신도 없음).
5. 원문을 `Log` 탭에 먼저 기록한다(raw_text). 이후 어떤 예외가 나도 추적 가능하게 한다. 이 Log 행 번호가 버튼의 열쇠다.
6. `Parser.parseMessage(text, ctx)` 가 의도(record/query/undo/move/unknown), 금액 후보, 통화, 날짜, 가맹점, 환불 여부를 규칙 기반으로 추출한다.
   금액 후보가 여럿이고 확신이 같으면 금액 버튼을 먼저 보낸다.
7. 이 달이 아직 안 열렸으면(예산 행·예정 행 없음) `ensureMonthOpened` 가 연다. 월 시작 트리거가 빠져도 보정된다.
8. `Classifier.classify(merchantText, merchants)` 가 `Merchants` 사전에서 최장 일치 keyword 를 찾는다. 없으면 `LedgerRules.matchRecurringName` 이 Recurring 이름(kind=fixed)을 본다.
9. 매칭되면 `Ledger.recordTransaction` 이 기록한다.
   - 고정 항목(kind=fixed)이면 `LedgerRules.pickConfirmTarget` 이 그 달의 **expected 행만** 확정 대상으로 고른다. 이미 확정된 뒤의 두 번째 결제는 새 confirmed 행이다. 덮어쓰지 않는다.
   - 부채와 연결된 고정비면 `Debts` 의 원금·남은 회차가 상각 규칙으로 줄어든다.
   - 그 밖에는 append 한다. 환불은 같은 세부예산의 음수 지출이다.
   - 기록한 행은 사용자별 "마지막 기록" 으로 캐시와 Log 에 남아, "취소" 가 정확히 그 행을 되돌린다(확정은 expected 로 복원).
10. 미매칭이면 세부예산 선택 버튼(`cls|<Log행>|<index>`)을 **먼저** 보내고, LLM 추천이 있으면 버튼 순서만 바꾼다. 콜백은 잠금 안에서 처리하고 캐시를 지운 뒤 기록하므로 연타해도 한 번이다.
    캐시가 만료돼도 Log 의 parsed_json 에서 복구하므로 버튼이 "만료" 되는 일은 사실상 없다.
11. `Budget.envelopeStatus` 로 해당 세부예산의 잔액과 오늘 가용액을 계산해 한 줄로 회신한다. 빨강이면 "예비비에서 $N 옮기기" 버튼이 붙는다.
12. `Log` 탭의 해당 행에 parsed_json 과 result(`기록 tx_…`, `확정 tx_…`, `환불 tx_…`)를 남긴다.

## 보안 경계
- **시트 공유 = 접근 권한.** 데이터를 볼 수 있는 사람은 Google Sheet 에 편집자로 공유된 계정뿐이다. 웹앱도 이 권한을 그대로 쓴다.
- **웹훅 인증.** Apps Script `doPost` 는 요청 헤더를 읽을 수 없으므로 배포 URL 뒤에 `?token=<WEBHOOK_SECRET>` 을 붙여 등록하고, 이 파라미터를 첫 번째 검사로 비교한다.
- **허용 Telegram ID.** token 이 맞아도 `Config.allowed_telegram_ids` 에 없는 발신자는 무시한다.
- **비밀값은 Script Properties 에만.** `BOT_TOKEN`, `WEBHOOK_SECRET`, `SPREADSHEET_ID`, `WEBAPP_URL` 은 저장소에 절대 쓰지 않는다.
- **실제 숫자와 이름도 저장소에 없다.** 시드는 가짜 값이고, 우리 집 숫자는 gitignore 된 `PersonalSeed.js` 에만 있다. 문서 스크린샷은 가짜 데이터로 찍는다.
- **봇 회신 범위 제한.** 봇은 유동비 세부예산 잔액과 저축 진행까지만 회신한다. 고정비 상세, 부채, 자산, 목표는 회신하지 않는다.
- **감사 추적.** 모든 수신 메시지는 `Log` 에 남고, 원장은 soft delete 만 허용하므로 누가 언제 무엇을 바꿨는지 `updated_by`/`updated_at` 로 추적된다.

## 롤링 일일 가용액과 신호등
- `allowanceToday = (budget − spent_before_today) / remaining_days_incl_today` — 오늘 아침 기준 **하루치**.
- `allowanceLeftToday = allowanceToday − spentToday` — 하루치에서 오늘 쓴 만큼 뺀 **지금 남은 오늘치**. 사람에게 먼저 보여 주는 숫자다.
  $60 를 쓴 직후 이 숫자가 내려가 있어야 경각심이 생긴다. 하루치는 보조 표기다.
- `budget`: 해당 월·세부예산의 `Budgets.amount`. `spent_*`: 그 달 `type=expense, kind=variable, status∈{active,confirmed}` 행의 `amount_usd` 합(환불은 음수).
- `remaining_days_incl_today`: 오늘을 포함해 그 달 말일까지 남은 일수.
- 예: 9/10, 예산 $1000, 오늘 이전 지출 $195.02, 오늘 $20 → 하루치 $38.33, 오늘 남은 $18.33.
- 예산 초과 시 음수가 될 수 있으며 그대로 표시한다(숨기지 않는다).
- 보조 지표: `plannedPaceToDate = budget × (dayOfMonth / daysInMonth)`, `deltaVsPlan = plannedPaceToDate − spentTotal`.
- 신호등(`Budget.signalOf`): 🟢 `deltaVsPlan ≥ 0`, 🟡 계획보다 앞서 썼지만 예산의 10% 이내, 🔴 그 이상이거나 세부예산 잔액이 음수.
  아침 요약은 전부 🟢 이면 한 줄, 아니면 문제 있는 세부예산만 길게 쓴다. 알림 피로를 막는 방법이다.

## 재무 구조
- **먼저 저축.** `Recurring.type=transfer` 항목(저축)은 고정비처럼 예정→확정으로 다루되 수입·지출 합계에 넣지 않는다. Today 화면과 아침 요약에 "이달 저축" 이 있다.
- **싱킹 펀드.** `연간비` 같은 `carry` 세부예산에 매달 조금씩 넣어 두면 보험·명절·여행이 그 달 세부예산을 터뜨리지 않는다.
- **초과분 흡수.** 전월 초과분의 합은 다음 달 `overspend_envelope`(예비비)에서 뺀다. 소비 세부예산은 정상 예산으로 시작한다(ADR-0003 b).
- **부채 상각.** `Debts.recurring_id` 로 연결된 고정비가 확정되면 원금과 남은 회차가 줄어든다. 웹앱은 이자를 반영한 상환 종료를 보여 주고, 이율이 가장 높은 부채(눈사태)를 가리킨다.
- **비상금.** 활성 고정비 월 합 × `emergency_fund_months` 가 목표이고, 최신 자산 스냅샷이 몇 개월분인지 Today 와 목표 화면에 보인다.
- **환율.** 거래는 기록 시점 환율로 `amount_usd` 를 굳힌다. 자산 스냅샷은 그날 환율(`fx_usd_krw` 열)을 함께 적을 수 있다.
