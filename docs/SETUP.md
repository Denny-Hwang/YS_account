# SETUP.md — 수동 설치 절차

이 문서의 값(스프레드시트 ID, 봇 토큰 등)은 **저장소에 절대 커밋하지 않는다.**
모두 Apps Script `Script Properties` 에만 저장한다.

## 사전 준비 (Claude Code 실행 전)
1. 빈 Google Sheet 생성 → URL 의 `/d/<SPREADSHEET_ID>/` 기록. 배우자 계정에 **편집자**로 공유.
2. 시트 메뉴 `확장 프로그램 → Apps Script` → 빈 프로젝트 생성 → 프로젝트 설정에서 `Script ID` 기록.
3. Telegram `@BotFather` → `/newbot` → `BOT_TOKEN` 기록. `/setprivacy` 는 기본(Enabled) 유지.
4. 두 사람의 Telegram user ID 확인 (`@userinfobot` 에 아무 메시지) → 숫자 ID 2개 기록.
5. `openssl rand -hex 24` 로 `WEBHOOK_SECRET` 생성.
6. (선택) `npm i -g @google/clasp && clasp login --no-localhost`.

---

## P1 — 시트 스키마 만들기

### a. 코드 올리기
**clasp 사용 시**
```bash
cd apps-script
cp .clasp.json.example .clasp.json     # .gitignore 대상이라 커밋되지 않음
# .clasp.json 의 <SCRIPT_ID> 를 실제 Script ID 로 교체
clasp push
```

**clasp 미사용 시**
Apps Script 편집기에서 `src/` 의 각 파일을 **같은 파일명**으로 새로 만들어 내용을 붙여넣는다
(`Config.gs`, `Sheet.gs`, `Setup.gs` … 편집기가 확장자를 `.gs` 로 표시해도 무방하다).
프로젝트 설정에서 "`appsscript.json` 매니페스트 파일 표시"를 켜고 `appsscript.json` 내용도 맞춘다.

### b. Script Properties 등록
Apps Script 편집기 → `프로젝트 설정` → `스크립트 속성` 에서 추가한다.

| 키 | 값 | 사용 단계 |
|---|---|---|
| `SPREADSHEET_ID` | 1단계에서 기록한 ID | P1~ |
| `BOT_TOKEN` | BotFather 토큰 | P3 |
| `WEBHOOK_SECRET` | `openssl rand -hex 24` 결과 | P3 |
| `WEBAPP_URL` | 웹 앱 배포 URL | P3 (배포 후) |

### c. 시트 생성
편집기 상단 함수 선택에서 `runSetupAll` 을 고르고 실행한다.
최초 실행 시 권한 승인 창이 뜨면 승인한다(본인 계정의 시트에만 접근).
실행 후 다음 탭이 생겼는지 확인한다:
`Transactions, Recurring, Budgets, Merchants, Debts, Assets, Goals, Config, Log, Monthly_View, Dashboard`

`runSetupAll` 은 멱등이다. 다시 실행해도 기존 데이터는 변하지 않는다.
기존 탭의 헤더가 다르면 오류를 내고 **데이터는 건드리지 않는다**.

### d. 값 채우기
1. `Config` 탭 → `allowed_telegram_ids` 에 두 사람 Telegram 숫자 ID 를 콤마로 입력 (예: `11111111,22222222`).
2. `Config` 탭 → `fx_usd_krw` 를 현재 환율로 조정. `envelopes` 를 바꾸면 봇 버튼·예산 시드가 따라간다.
3. `Budgets` 탭 → 이번 달 각 세부예산의 `amount` 를 실제 예산으로 입력. 월말 이월이 필요하면 `carryover` 를 `carry` 로.
4. `Recurring` 탭 → 시드된 항목(전부 가짜 숫자)의 `expected_amount`, `due_day` 를 실제 값으로 수정하거나, 아래 e 처럼 PersonalSeed 로 덮어쓴다.
   `type` 열이 `transfer` 인 `S01 저축` 은 "먼저 저축" 항목이다. 매달 옮길 금액을 적는다. 필요 없으면 `active=N`.
   `R08 기부` 는 `income_pct:10` 규칙이라 그 달 수입의 10% 로 계산된다.
5. `Config.envelopes` 를 바꿨다면 `setupSheet` 을 한 번 더 실행해 드롭다운을 갱신한다.

### e. 우리 집 숫자 넣기 (PersonalSeed)
실제 예산·고정비·대출 금액은 **저장소에 두지 않는다.** 이 저장소는 공개라서 커밋하면 누구나 본다.
대신 `.gitignore` 에 걸린 파일 하나에 모아 두고 Apps Script 에만 올린다.

1. `apps-script/PersonalSeed.js.example` 을 `apps-script/src/PersonalSeed.js` 로 복사한다.
   (이미 채워진 파일을 받았다면 그 파일을 같은 자리에 둔다.)
2. 숫자를 실제 값으로 바꾼다. `PERSONAL_ENVELOPES`(세부예산 예산), `PERSONAL_RECURRING`(고정비), `PERSONAL_DEBTS`(부채).
3. `clasp push`. `git status` 에 이 파일이 안 보이는 게 정상이다.
4. 편집기에서 `runSetupAll` 을 먼저 실행한 뒤 **`applyPersonalDefaults`** 를 실행한다.

여러 번 실행해도 같은 결과다. id 가 같은 행은 갱신하고 없는 행은 추가한다.
Recurring 의 `active` 는 건드리지 않으므로 시트에서 끈 항목은 꺼진 채로 남는다.
실행 로그에 `세부예산 3개 · 예산 3행 · 고정비 추가 N / 갱신 M · 부채 추가 …` 가 찍히면 끝이다.

`Config.fx_usd_krw` 가 예산표의 환율(1,332)과 다르면 KRW 항목의 달러 환산이 어긋난다. 먼저 맞춘다.

---

## P3 — Telegram 웹훅 연결

### a. 웹 앱 배포
Apps Script 편집기 → 우상단 `배포` → `새 배포` → 유형 `웹 앱`

| 항목 | 값 |
|---|---|
| 설명 | family-budget webhook |
| 실행 사용자 | **나** (본인 계정) |
| 액세스 권한 | **모든 사용자** |

배포하면 `https://script.google.com/macros/s/AKfycb.../exec` 형태의 URL 이 나온다.
이 URL 을 Script Properties 의 `WEBAPP_URL` 에 저장한다. **URL 자체가 비밀값이다.**

#### 코드를 고친 뒤에는 반드시 새 버전을 배포한다
`clasp push` 나 편집기 저장은 **코드만** 올린다. 웹훅이 부르는 `/exec` 주소는 마지막으로 배포한 버전을
계속 실행한다. 새 코드를 웹훅에 반영하려면:

1. 편집기 우상단 `배포` → `배포 관리`
2. 기존 배포의 연필 아이콘 → 버전 드롭다운에서 **새 버전** → `배포`

이렇게 하면 URL 이 그대로라 `setWebhook` 을 다시 할 필요가 없다.
`새 배포` 를 새로 만들면 URL 이 바뀌므로 `WEBAPP_URL` 을 갱신하고 `setWebhook` 을 다시 실행해야 한다.

편집기의 `실행` 화면에서 `doPost` 실행 기록을 열어 보면 어느 버전이 돌았는지 나온다.
고친 코드가 안 도는 것 같으면 먼저 여기를 본다.

### b. 사람 이름 매핑 (선택)
`Config` 탭에 `name_<telegram_id>` 키를 추가하면 원장의 `payer` 열에 그 이름이 들어간다.
예: key `name_11111111`, value `아빠`. 없으면 숫자 ID 가 그대로 들어간다.
`income_hints` 에 `레슨` 을 더하면 "레슨 학생A 40" 이 수입으로 잡힌다(기본값은 `수입,급여,입금`).

### c. 웹훅 등록
편집기에서 `setWebhook` 함수를 실행한다.
`WEBAPP_URL` 과 `WEBHOOK_SECRET` 을 읽어 `<WEBAPP_URL>?token=<WEBHOOK_SECRET>` 으로 등록한다.
실행 로그에 "웹훅 등록 완료" 가 찍히면 성공이다. 실패하면 `Log` 탭을 본다.
해제는 `deleteWebhook` 이다.

### d. 동작 확인
1. 봇에게 `코스트코 1.00` 을 보낸다.
   - `Transactions` 탭에 `status=active`, `envelope=식료품` 행이 생긴다.
   - `Log` 탭에 원문과 파싱 결과가 남는다.
   - 봇이 `🟢 식료품 오늘 남은 $... · 하루치 $... · 잔액 $... · 계획 대비 +$...` 로 회신한다.
2. 봇에게 `취소` 를 보낸다. 방금 행의 `status` 가 `deleted` 로 바뀌고 회신이 온다.
   행이 사라지지 않는 것이 정상이다(append-only + soft delete). 고정 항목을 확정한 뒤 `취소` 하면 그 행이 `expected` 로 돌아간다.
   `환불 코스트코 20` 은 같은 세부예산에 음수 지출로 들어가고, `이동 예비비→식료품 50` 은 이번 달 예산을 옮긴다.
3. 사전에 없는 가맹점(`처음가게 5`)을 보내면 세부예산 선택 버튼이 온다.
   버튼을 누르면 `Merchants` 에 학습되고 원장에 기록된다.
4. `얼마 남았어` 를 보내면 세부예산별 상태가 한 줄씩 온다.

### 문제가 생기면
**먼저 `Telegram.gs` 의 `diagnoseWebhook` 을 실행한다.** 실행 로그에 원인 후보가 한 번에 나온다.
비밀값은 가려서 찍으므로 결과를 그대로 복사해도 된다.
`마지막 오류` 에 `302 Found` 가 보이면 이어서 `Telegram.gs` 의 `probeWebappUrl` 을 실행한다.
배포 URL 을 Telegram 과 같은 조건(리디렉션 미추적)으로 직접 두드려 실제 상태 코드를 알려 준다.

| `probeWebappUrl` 결과 | 뜻 | 조치 |
|---|---|---|
| `HTTP 200` | 웹 앱은 정상. 등록된 웹훅이 예전 배포를 봄 | `setWebhook` 재실행 |
| `HTTP 302` + `accounts.google.com` | 배포가 로그인을 요구함 | 액세스 권한을 "모든 사용자" 로 바꾸고 새 버전 배포 |
| `HTTP 302` + `googleusercontent.com` | 배포 설정 문제가 아님(아래 참고) | `webhookWatchdog` 이 자동으로 처리한다 |

#### 302 는 왜 없앨 수 없나

Apps Script 웹 앱은 응답 본문을 `script.googleusercontent.com` 에서 내보내려고 302 리디렉션을 건다.
Telegram 은 이 이동을 따라가지 않으므로 **성공한 배달도 전부 실패로 기록한다.** 배포 설정 문제가 아니고
코드로 바꿀 수도 없다. 실제로 일어나는 일은 이렇다.

1. 메시지가 들어오면 `doPost` 는 정상 실행된다(그래서 `Log` 에 남고 회신도 간다)
2. Telegram 은 302 를 실패로 보고 재전송한다 → `claimUpdate` 가 중복을 막아 회신은 한 번만 간다
3. **실패가 쌓이면 Telegram 이 배달 간격을 늘린다.** 그러다 아예 안 들어오는 상태가 된다

3번이 "회신이 올 때도 있고 안 올 때도 있는" 진짜 원인이다. `Jobs.gs` 의 `webhookWatchdog` 이
5분마다 밀린 건을 보고, 있으면 웹훅을 잠시 떼고 `getUpdates` 로 직접 받아 처리한 뒤 다시 붙인다.
메시지를 버리지 않으면서 Telegram 쪽 실패 누적도 초기화된다. 밀린 건이 없으면 아무것도 하지 않는다.

평소에는 지금처럼 웹훅으로 1~2초 안에 회신이 오고, 막히더라도 최대 5분 안에 저절로 풀린다.

- **회신이 올 때도 있고 안 올 때도 있다** → `Log` 탭 꼬리를 보고 셋 중 어디인지 가른다.
  1. `수신` 줄이 있고 회신만 없다 → 회신 쪽 문제다. 같은 줄 근처의 `tg:sendMessage` 오류를 본다.
  2. `거부:` 줄이 있다 → 그 줄이 사유다. `allowed_telegram_ids` 에 없는 id 면 그 줄에 실제 id 가 찍혀 있으니
     `Config` 탭에 그대로 넣는다. 두 사람 중 한 명만 회신을 못 받는 전형적인 원인이다.
  3. 아무 줄도 없다 → 요청이 스크립트에 닿지 않았다. `diagnoseWebhook` 의 `배포 URL 일치`,
     `token 일치`, `밀린 업데이트`, `마지막 오류` 를 본다. `새 배포` 를 새로 만들었으면 URL 이 바뀌었으므로
     `WEBAPP_URL` 을 갱신하고 `setWebhook` 을 다시 실행해야 한다.
- 배포 설정은 `실행 계정: 나`, `액세스 권한: 모든 사용자` 여야 한다. 주소는 `/dev` 가 아니라 `/exec` 다.
- `Config.allowed_telegram_ids` 에 두 사람 ID 가 콤마로 정확히 들어갔는지 확인한다(공백 무방).
- Config 값은 5분 캐시된다. 바꾼 직후라면 잠시 기다리거나 `clearConfigCache` 를 실행한다.
- **회신이 여러 번 온다** → 순서대로 본다.
  1. 위 "새 버전 배포" 를 했는가. 안 했으면 웹훅은 아직 예전 코드를 돌리고 있다.
  2. `getWebhookInfo` 를 실행해 `last_error_message` 와 `pending_update_count` 를 본다.
     오류 메시지가 있으면 Telegram 이 응답을 제때 못 받아 재전송하고 있다는 뜻이다.
  3. `Log` 탭에서 같은 `update_id` 가 여러 줄인지 본다. 여러 줄이면 중복 검사가 안 도는 것이고,
     한 줄인데 답장이 여러 번이면 회신 쪽 문제다.
  4. `setupSheet` 을 한 번 실행해 `Log` 탭에 `update_id` 열이 있는지 확인한다.

### e. 금액이 정해진 고정비는 미리 빼 둔다

렌트가 아직 안 나갔다고 예산에서 빼지 않으면 달 초에는 늘 여유가 있어 보이고 말일에 갑자기 부족해진다.
그래서 **금액이 정해진 고정비는 달이 열릴 때 바로 예산에서 뺀다.**

| `Recurring.certainty` | 그 달 예약 행 상태 | 예산 반영 | 보기 |
|---|---|---|---|
| `fixed` (렌트·구독료·보험·부채상환·저축) | `committed` | 달이 열릴 때 바로 | 원장에 `확정·선반영` 배지 |
| `variable` (관리비·전기세·유류비·급여) | `expected` | 실제 금액을 보낼 때 | 원장에 `예정` 배지 |

- 어느 쪽인지는 웹앱 **고정비** 화면에서 항목을 눌러 `금액 확정으로` / `금액 변동으로` 로 바꾼다.
  시트의 `Recurring.certainty` 열을 직접 고쳐도 된다.
- `certainty` 를 비워 두면 `tolerance_pct` 가 0 이고 `amount_rule` 이 `fixed` 인 지출을 확정으로 본다.
- 이미 만들어진 달을 새 기준으로 맞추려면 `Recurring.gs` 의 `resyncReservedStatuses` 를 실행한다.
- `committed` 행도 실제 금액을 보내면 그 행이 `confirmed` 로 바뀐다. 새 행이 생기지 않으므로 두 번 세지 않는다.
  `취소` 하면 `committed` 로 돌아가 예산에서는 계속 빠진 채로 남는다.

수입은 반대다. 들어올 예정인 급여는 실제로 받기 전까지 수입 합계에 넣지 않는다.
더해 놓으면 "이번 달 흑자" 처럼 보이는 반대 방향의 착시가 생긴다.

---

## P4 — 시간 트리거 설치

### a. 트리거 설치
편집기에서 `installTriggers` 를 실행한다. 이 네 함수의 트리거만 지우고 새로 등록한다(멱등). 직접 만든 다른 트리거는 건드리지 않는다.

| 함수 | 주기 | 하는 일 |
|---|---|---|
| `dailySummary` | 매일 `Config.daily_summary_hour` 시 | 전부 🟢 이면 한 줄, 아니면 문제 세부예산만 길게. 저축 진행, 오늘 결제일 고정 항목, 지나간 미확정 항목 |
| `weeklyDigest` | 매일 19시 | `Config.weekly_digest_day`(0=일요일) 에만 동작. 이번 주 vs 지난주 유동비, 세부예산별 잔액, 남은 기간 하루치 |
| `monthlyOpen` | 매월 1일 06시 | 예산 시드(전월 복사 + carry 이월 + 초과분 예비비 흡수), 고정 항목 expected 생성, 요약 |
| `monthlyClose` | 매일 21시 | **말일에만** 동작. 세부예산 결산, 점수 3개(저축률·예산 안 세부예산·편차)를 지난달과 나란히, 미확인 항목 보고 |

트리거가 빠져도 첫 기록이나 아침 요약 때 `ensureMonthOpened` 가 그 달을 연다.

> `monthlyClose` 를 매일 21시로 두고 말일 여부를 코드에서 판정한다.
> 달마다 말일이 28/29/30/31 로 달라지는데 Apps Script 의 월간 트리거는 고정된 날짜만 받기 때문이다.
> 말일이 아닌 날에는 아무 메시지도 보내지 않는다.

편집기 좌측 `트리거` 화면에서 세 개가 보이는지 확인한다.

### b. 동작 확인
1. `dailySummary` 를 수동 실행한다. 봇이 `allowed_telegram_ids` 전원에게 요약 메시지를 보낸다.
2. `postMonthlyRecurring` 을 수동 실행한다. `Transactions` 에 `status=expected`, `source=recurring` 인
   고정비 행이 생긴다. 한 번 더 실행해도 행이 늘지 않아야 한다(멱등).
3. 봇에게 `관리비 212` 를 보낸다. 위 expected 행이 `confirmed` 로 바뀌고 금액이 212 가 된다.
   같은 달에 `관리비 30` 을 또 보내면 이번에는 **새 행**이 생기고 회신에 "(이번 달 2번째)" 가 붙는다. 확정된 행은 덮어쓰지 않는다.
4. `monthlyClose` 는 말일이 아니면 빈 문자열을 돌려주고 아무것도 보내지 않는다.

### c. 권한
트리거가 처음 돌 때 실행 계정의 권한으로 동작한다. 실행 기록은 편집기 `실행` 화면에서 볼 수 있고,
Telegram 호출 실패는 `Log` 탭에 남는다.

---

## P5 — Monthly_View / Dashboard

`runSetupAll` 을 다시 실행하면 두 탭이 새로 그려진다. 수식만 들어가고 데이터는 넣지 않는다.
개별로 실행하려면 `buildMonthlyView`, `buildDashboard` 를 각각 실행한다.

### Monthly_View
- **B1** 에서 월(YYYY-MM)을 고르면 아래 다섯 블록이 모두 그 달로 바뀐다.
  드롭다운 목록은 `Transactions` 의 날짜에서 만든다.

| 블록 | 위치 | 내용 |
|---|---|---|
| 수입 | 3행 | 그 달 income 행 목록과 합계(H3) |
| 고정비 | 26행 | Recurring 정의별 예상·실제·편차·상태. `income_pct` 항목은 그 달 수입 합으로 계산 |
| 유동비 세부예산 | 49행 | 세부예산별 예산·실행·잔액·남은 일수·일일 가용액 |
| 카테고리 비중 | 62행 | 카테고리별 합계와 비중(%) |
| 원장 | 86행 | 그 달 `status≠deleted` 행 전부(날짜 내림차순) |

> 블록 1·2·3·4 는 각각 20/20/10/20 행을 쓴다. Recurring 정의나 세부예산이 그보다 많아지면
> `MV_ROWS` 의 행 수를 늘리고 `buildMonthlyView` 를 다시 실행한다.

### Dashboard
- A1 블록: 최근 12개월 수입·지출·순저축 (오늘 기준으로 자동 이동)
- F1 블록: 부채 목록과 원금 합계
- A18 블록: 목표별 진행률. 현재 자산은 `Assets` 의 **최신 스냅샷 날짜** 행 합계를 USD 로 환산한 값
- 우측: 최근 12개월 수입·지출 막대 차트

`Assets` 에 스냅샷을 추가할 때는 같은 `snapshot_date` 로 계좌별 행을 넣는다.
진행률은 그 날짜의 잔액 합계를 기준으로 계산한다.

---

## P6 — 기존 월별 탭 이관

옛 가계부의 월별 탭을 `Transactions` 원장으로 옮긴다. 원본 탭은 읽기만 하고 지우거나 고치지 않는다.

### a. 원본 확인
편집기에서 `previewMigrationSource` 를 실행한다. 인자를 주려면 편집기 하단 실행 로그 대신
임시 함수를 만들어 `previewMigrationSource('2025-01')` 을 호출하거나, 탭 이름을 바꿔 가며 확인한다.
헤더 이름과 첫 세 행이 로그에 찍힌다. 존재하지 않는 탭 이름을 주면 현재 탭 목록을 보여 준다.

### b. 매핑 채우기
`src/Migration.js` 맨 위의 `MIGRATION_MAP` 을 편집한다.

```js
tabs: [
  { name: '2025-01', month: '2025-01' },
  { name: '2025-02', month: '2025-02' }
],
columns: {
  date: '날짜',      // 원본 헤더 이름 그대로
  merchant: '내역',
  amount: '금액',
  category: '분류',
  envelope: '',      // 없으면 빈 문자열
  kind: '',
  memo: '메모',
  type: '',          // 수입/지출 구분 열이 있으면 지정
  payer: ''
}
```

`month` 는 원본 날짜에 연·월이 없을 때만 쓴다. `1/5`, `5`, `5일` 같은 값이 그 달의 날짜로 채워진다.

### c. 미리보기 → 실행
1. `migrateAll` 을 실행한다. **아무것도 쓰지 않고** 탭별로 추가 예정 건수와 오류를 보고한다.
2. 오류 줄을 보고 매핑이나 원본을 고친다. 합계 행처럼 금액이 글자인 행은 오류로 잡힌다.
3. 문제가 없으면 `migrateAllCommit` 을 실행한다.

원장 행 id 가 `mig_<탭이름>_<행번호>` 로 고정되므로 `migrateAllCommit` 을 여러 번 실행해도
같은 행이 중복되지 않는다. 이미 있는 행은 "기존 건너뜀" 으로 집계된다.

### d. 확인
- `migrationReport` 로 이관된 행 수를 센다.
- `Monthly_View` 의 B1 을 옮긴 달로 바꿔 금액이 맞는지 본다.
- 잘못 옮긴 행은 지우지 말고 `status` 를 `deleted` 로 바꾼다. 다시 실행하면 같은 id 라서 건너뛴다.

### 변환 규칙
- 금액: `1,234.56`, `$85.89`, `50,000원`, `5만원`, `(123)`, 음수를 모두 읽는다. `₩`·`원`·`만원` 은 KRW 로 본다.
- 날짜: `2025-01-05`, `2025/1/5`, `1/5`, `1월 5일`, `5`, `5일`. 셀이 날짜 값이면 시트 시간대로 먼저 변환한다.
- 유형: 구분 열이 있으면 그 값으로, 없으면 음수를 수입으로 본다.
- 세부예산: 비어 있고 유동비 지출이면 `MIGRATION_MAP.defaults.defaultEnvelope` 로 채운다.

---

## P7 — 웹앱 (GitHub Pages)

웹앱은 별도 서버가 없다. 브라우저가 구글 계정으로 로그인해 Sheets API 로 시트를 직접 읽고 쓴다.
**시트 공유 권한이 곧 접근 권한이다.** 시트에 편집자로 공유된 계정만 데이터를 볼 수 있다.

### a. Google Cloud 준비
구글이 2024년에 "OAuth 동의 화면" 메뉴를 **Google Auth Platform** 으로 옮기고 세 탭으로 나눴다.
아래는 그 기준이다. 예전 주소로 들어가도 자동으로 여기로 넘어온다.

1. [Google Cloud 콘솔](https://console.cloud.google.com/)에서 프로젝트를 하나 만든다(기존 것 재사용 가능).
2. `API 및 서비스 → 라이브러리` 에서 **Google Sheets API** 를 사용 설정한다.
   이걸 먼저 해야 아래 Google Auth Platform 메뉴가 나타난다.
3. 왼쪽 메뉴 `API 및 서비스 → Google Auth Platform` 을 연다. 바로 가기는 아래 표.

| 탭 | 바로 가기 | 여기서 하는 것 |
|---|---|---|
| Branding | `https://console.cloud.google.com/auth/branding` | 앱 이름(예: 우리집 가계부), 지원 이메일 |
| Audience | `https://console.cloud.google.com/auth/audience` | 사용자 유형 **외부**, 게시 상태 **테스트**, **테스트 사용자**에 두 사람 지메일 추가 |
| Clients | `https://console.cloud.google.com/auth/clients` | OAuth 클라이언트 ID 만들기 |

4. **Clients** 에서 `클라이언트 만들기`, 유형은 **웹 애플리케이션**.
   **승인된 JavaScript 원본** 에 `+ Add URI` 로 아래 두 줄을 **각각** 넣는다. 리디렉션 URI 는 비워 둔다.
   ```
   https://denny-hwang.github.io
   http://localhost:5173
   ```
   끝에 슬래시나 `/YS_account/` 같은 경로를 붙이면 거부된다. 도메인까지만이다.
5. 만들어진 클라이언트 ID 를 적어 둔다. 이 값은 비밀이 아니다(브라우저에 그대로 노출된다).
   접근을 막는 것은 이 값이 아니라 시트 공유 권한과 테스트 사용자 목록이다.

> **`client_secret_….json` 은 내려받지 않아도 되고, 받았으면 저장소 폴더 밖으로 옮긴다.**
> 이 웹앱은 브라우저에서 도는 토큰 방식이라 클라이언트 **시크릿**을 쓰지 않는다. 클라이언트 ID 문자열만 있으면 된다.
> 그 파일이 저장소 안에 있으면 실수로 커밋될 수 있어 `.gitignore` 와 CI 검사로 막아 두었지만, 애초에 두지 않는 편이 낫다.

**`Error 403: access_denied` — "has not completed the Google verification process"**
로그인하려는 계정이 Audience 탭의 테스트 사용자에 없다는 뜻이다. 프로젝트 소유자도 예외가 아니다.
`/auth/audience` 에서 그 계정을 추가하고 다시 시도한다. 브라우저에 구글 계정이 여러 개면 시크릿 창에서 확인한다.
게시 상태를 "프로덕션" 으로 올리지 않는다. 시트 권한은 민감한 범위라 심사가 필요하고, 두 사람만 쓰는 앱에는 테스트 상태로 충분하다(100명까지).

### b. GitHub Pages 켜기
1. 저장소 `Settings → Pages → Build and deployment → Source` 를 **GitHub Actions** 로 바꾼다.
2. `main` 에 `webapp/` 변경이 올라가면 `.github/workflows/deploy-webapp.yml` 이 자동으로 배포한다.
   수동 실행은 `Actions → 웹앱 GitHub Pages 배포 → Run workflow`.
3. (선택) `Settings → Secrets and variables → Actions → Variables` 에 `GOOGLE_CLIENT_ID` 를 넣으면
   앱이 클라이언트 ID 를 미리 채운다. 넣지 않아도 앱의 설정 화면에서 입력하면 된다.

배포 주소는 `https://denny-hwang.github.io/YS_account/` 다.

### c. 앱 첫 실행
1. 위 주소를 연다. 설정 화면이 먼저 나온다.
2. **OAuth 클라이언트 ID** 와 **스프레드시트 주소**(전체 URL 을 붙여 넣어도 된다)를 입력하고 저장한다.
3. `구글 계정으로 연결` 을 누르고 동의한다.
4. 홈 화면에 추가하면 앱처럼 쓸 수 있다(PWA).

> 두 값은 이 기기의 `localStorage` 에만 저장된다. 저장소에도, 빌드 결과물에도 들어가지 않는다.
> 기기를 바꾸면 다시 입력해야 한다. 이것이 Golden Rule 1 을 지키는 방식이다.

### d. 로컬 개발
```bash
cd webapp
npm install
npm run dev       # http://localhost:5173
npm test          # 공유 모듈 브리지 테스트
npm run build     # 타입 검사 + 프로덕션 빌드
```

### 화면
- **오늘**: 세부예산별 오늘 쓸 수 있는 금액, 잔액, 계획 대비 차이. 맨 위 빠른 입력은 봇과 같은 파서를 쓴다.
- **원장**: 월별 목록. 항목을 누르면 날짜·금액·통화·유형·세부예산·카테고리·메모를 고칠 수 있다.
  삭제는 행을 지우지 않고 `status` 를 `deleted` 로 바꾼다. 되살리기도 된다.
- **설정**: 연결 값 입력과 로그아웃.

---

## P8 — 웹앱 확장 화면

하단 탭은 다섯 개다. **오늘 / 원장 / 예산 / 리포트 / 더보기**.
고정비·부채·자산·목표·설정은 더보기 안에 있다.

| 화면 | 하는 일 | 쓰는 탭 |
|---|---|---|
| 예산 | 월별 세부예산 예산 입력, 월말 이월 방식 선택, 실행·잔액 확인 | `Budgets` |
| 고정비 | 정기 항목의 예상 금액 수정, 사용/중지, 이번 달 확정 여부와 편차 | `Recurring` |
| 부채 | 남은 원금·이율·월 상환액·남은 회차. 추가와 수정 | `Debts` |
| 자산 | 같은 날짜로 계좌별 잔액을 넣는 스냅샷. 최신 합계를 USD 로 환산 | `Assets` |
| 목표 | 목표액 대비 진행률. 최신 자산 합계를 기준으로 계산 | `Goals` |
| 리포트 | 최근 12개월 수입·지출 막대, 월 순저축, 카테고리 비중 | `Transactions`, `Assets` |

### 리포트 읽는 법
- 막대를 누르면 그 달이 선택되고 맨 위 순저축 카드와 카테고리 목록이 함께 바뀐다.
- `표로` 를 누르면 같은 수치를 표로 본다. 색을 구분하기 어려운 경우에도 값을 읽을 수 있다.
- 수입은 파랑, 지출은 주황이다. 두 색은 색각 이상과 명암 기준을 모두 통과하도록 고른 조합이다.

### 주의
- 예산과 고정비 수정은 시트에 바로 쓴다. 되돌리려면 시트에서 값을 되돌리거나 다시 입력한다.
- 자산은 덮어쓰지 말고 **새 날짜로 새 행**을 넣는다. 리포트의 진행률은 가장 최근 날짜만 본다.
- 원장 삭제는 언제나 soft delete 다. 원장 탭에서 `삭제 포함` 을 켜면 되살릴 수 있다.

---

## P9 — 선택 기능 (분류 보조 · 영수증 · CSV 대조)

세 가지 모두 **끄고도 나머지가 그대로 돌아간다.** 필요할 때만 켠다.

### a. LLM 분류 보조 (선택)
사전에 없는 가맹점이 들어오면 Claude 가 세부예산 하나를 추천하고, 그 버튼을 맨 앞에 올린다.
**추천일 뿐이다. 기록은 사용자가 버튼을 눌러야 일어난다.** 금액·날짜는 절대 LLM 이 건드리지 않는다.

1. [Anthropic Console](https://console.anthropic.com/) 에서 API 키를 만든다.
2. Script Properties 에 `ANTHROPIC_API_KEY` 로 저장한다.
3. 끝이다. 키가 없으면 기능이 조용히 꺼지고 버튼은 원래 순서로 나온다.

같은 가맹점은 하루 동안 캐시하므로 반복 호출이 없다. 호출 실패나 거부는 Log 탭에 남고
봇은 평소대로 버튼을 보낸다.

### b. 영수증 사진 (선택)
봇에게 영수증 사진을 보내면 글자를 읽어 총액을 찾고, 분류 버튼과 함께 확인을 요청한다.

1. Apps Script 편집기 → `서비스` → **Drive API** 를 `Drive` 라는 이름으로 추가한다(v2).
   `src/appsscript.json` 에 이미 선언돼 있으므로 clasp 로 올렸다면 자동으로 잡힌다.
2. 처음 실행할 때 Drive 권한 승인 창이 뜬다.
3. 원본 사진은 Drive 의 `family-budget-receipts` 폴더에 남고, 원장 메모에 링크가 들어간다.

OCR 은 글자만 뽑는다. **금액은 그 글자에 규칙 기반 파서를 돌려서 찾는다.**
그래서 결과는 항상 "확인 필요" 상태이고, 버튼을 눌러야 기록된다.
읽은 금액이 틀리면 그냥 `코스트코 85.89` 처럼 직접 보내면 된다.
OCR 언어는 Config 에 `ocr_language` 키를 넣어 바꿀 수 있다(기본 `ko`).

### c. 카드·은행 CSV 대조 (선택)
명세서와 원장을 맞춰 보고 빠진 것과 남는 것을 알려 준다. **원장을 고치지는 않는다.**

1. Drive 에 `family-budget-statements` 폴더를 만들고 명세서 CSV 를 올린다(폴더는 자동 생성도 된다).
2. `src/Reconcile.js` 의 `RECONCILE_MAP` 에서 열 이름을 명세서에 맞춘다.
   지출이 양수로 적히는 명세서면 `expenseIsNegative` 를 `false` 로 바꾼다.
3. `reconcileLatest` 를 실행한다. 결과는 실행 로그와 `Log` 탭에 남는다.

열 이름이 틀리면 명세서의 실제 헤더 목록을 보여 주므로 그대로 복사해 넣으면 된다.
금액이 같고 날짜가 사흘 안이면 같은 건으로 본다. 원장 행 하나는 명세서 한 건에만 쓰인다.

---

## P10 — 웹앱 시각화 개편과 예상 수입

### a. 시트에 열 하나 추가
`Recurring` 탭에 `type` 열(income / expense)이 생겼다. 급여나 레슨 같은 수입원도 이 탭에 둔다.

1. `git pull origin main` → `cd apps-script` → `clasp push`
2. 편집기에서 `setupSheet` 을 한 번 실행한다. 기존 `Recurring` 탭 마지막 열 뒤에 `type` 이 붙는다.
   비어 있는 행은 expense 로 본다. 기존 12개 고정비는 손댈 것이 없다.
3. `배포 → 배포 관리 → 연필 → 새 버전 → 배포`. 봇 코드(Webhook/Ledger/Recurring)가 바뀌었다.

### b. 수입원 등록 (웹앱 `수입` 탭)
`수입원 추가` 로 두 개를 넣는다.

| 이름 | 방식 | 카테고리 | 월 예상 금액 | 입금일 |
|---|---|---|---|---|
| 급여 | 고정 | 급여 | 2주급 × 26 ÷ 12 (월 환산) | 급여일 |
| 레슨 | 변동 | 레슨 | 월 평균 예상치 | (무관) |

- **고정** 은 매월 `postMonthlyRecurring` 이 예정 행을 만들고, 봇에 `급여 2400` 을 보내면 그 행이 확정된다.
  이름이 Recurring 항목 이름과 같으면 Merchants 사전에 없어도 잡힌다.
- **변동** 은 예정 행을 만들지 않는다. `레슨 학생A 40` 처럼 건별로 기록하면 같은 카테고리의 합이 수입 탭에 잡힌다.
  Merchants 사전의 `레슨` 이 카테고리 `레슨` 으로 연결돼 있으니 카테고리 이름을 그대로 쓴다. `Config.income_hints` 에 `레슨` 을 넣어 둔다.
- 등록 뒤 편집기에서 `postMonthlyRecurring` 을 한 번 실행하면 이번 달 급여 예정 행이 바로 생긴다.

### c. 화면 읽는 법
- **불릿 막대**(오늘·예산·수입·고정비): 회색 트랙이 목표(예산·예상), 색 막대가 실제, 검은 눈금이 오늘까지의 계획 진도.
  막대가 눈금 왼쪽이면 계획보다 덜 쓴 것이다. 초과하면 막대가 빨갛게 바뀌고 `초과` 라벨이 붙는다.
- **리포트**: 막대를 누르면 그 달로 바뀌고 아래 모든 카드가 따라간다. `표로` 를 누르면 같은 수치를 표로 본다.
  - 순저축 추이: 위로 솟으면 남긴 달, 아래로 내려가면 모자란 달.
  - 고정비와 유동비: 회색이 고정, 주황이 유동. 유동비 비중이 줄어드는지 본다.
  - 유동비 누적: 실선이 실제, 점선이 예산을 일수로 나눈 계획선. 실선이 점선 아래면 여유가 있다.
  - 세부예산별 6개월 추이: 점선이 이번 달 예산.
  - 카테고리의 ▲▼ 는 전월 대비 증감.
- **부채**: 원금 구성과 상환 종료까지 남은 개월. 먼저 끝나는 것부터 월 상환액이 줄어든다.
- **자산**: 스냅샷이 두 개 이상이면 추이 선이 그려진다. 같은 날짜로 계좌마다 한 줄씩 넣는다.
- **목표**: 최근 6개월 월평균 순저축으로 도달 시점을 어림한다. 순저축이 음수면 계산하지 않는다.

색은 역할로 고정돼 있다. 파랑 = 수입·자산, 주황 = 지출·부채, 회색 = 계획·기준, 빨강 = 초과(항상 글자와 함께).

---

## P11 — 리뷰 제안 반영 (2026-09-13)

`docs/REVIEW-2026-09-13.md` 의 제안을 전부 반영했다. 이미 돌아가는 시트가 있다면 아래만 하면 된다.

### a. 코드와 시트
1. `git pull origin main` → `cd apps-script` → `clasp push`
2. 편집기에서 `setupSheet` 을 한 번 실행한다. `Debts` 에 `recurring_id`, `Assets` 에 `fx_usd_krw` 열이 붙고
   Config 에 `income_hints`, `overspend_envelope`, `emergency_fund_months`, `weekly_digest_day` 가 생긴다.
3. `runSetupAll` 을 실행하면 `Monthly_View`·`Dashboard` 가 새 기준(active/confirmed 만 합산)으로 다시 그려진다.
4. `installTriggers` 를 실행한다. `weeklyDigest` 가 추가된다.
5. `배포 → 배포 관리 → 연필 → 새 버전 → 배포`. 봇 코드가 바뀌었다.

### b. 시트에서 정할 것
- `Config.income_hints`: 레슨 수입이 있으면 `수입,급여,입금,레슨`.
- `Config.overspend_envelope`: 전월 초과분을 흡수할 세부예산. 기본 `예비비`. 이 세부예산의 `Budgets.carryover` 는 `carry` 가 자연스럽다.
- 연간비 세부예산을 쓰려면 `Config.envelopes` 에 `연간비` 를 더하고 `Budgets` 에 매달 적립액을 `carry` 로 넣는다.
- 저축: `Recurring` 에 `type=transfer` 항목을 두면(시드 `S01`) 매달 예정 행이 생기고 `저축 300` 으로 확정한다.
- **2주급 급여**: `Recurring` 의 급여 행 `amount_rule` 을 `biweekly:<1회 금액>@<기준 급여일>` 로 적는다.
  예: `biweekly:2600@2026-01-02`. 기준 급여일은 실제로 받은 날 아무거나 하나면 된다.
  그 달 급여일이 2번이면 예상 5,200, 3번인 달은 7,800 으로 저절로 바뀐다. 손으로 고칠 일이 없다.
  받을 때마다 `급여 2600` 을 보내면 된다. 웹앱 수입 탭에 그 달 급여일이 며칠인지 표시된다.
- 부채 상각: `Debts.recurring_id` 에 상환 고정비 id 를 적으면 확정할 때 원금·남은 회차가 줄어든다.
- 비상금: `Config.emergency_fund_months`(기본 3). 목표 화면과 Today 에 자동으로 보인다.

### c. 달라진 봇 동작
- 회신: `🟢 식료품 오늘 남은 $18.33 · 하루치 $38.33 · 잔액 $784.98 · 계획 대비 +$118.31`. 🔴 이면 "예비비에서 $N 옮기기" 버튼.
- `물 2병 5.99` → $5.99. `코스트코 2 3` 처럼 정말 애매하면 금액 버튼을 먼저 보낸다.
- `환불 코스트코 20` → 같은 세부예산 −$20. `이동 예비비→식료품 50` → 이번 달 예산 이동.
- `취소` → 정확히 마지막 기록. 확정한 고정 항목은 `expected` 로 되돌아간다.
- **까먹은 지출은 날짜를 앞에 붙여 적는다.** `어제 세이프웨이 13.97`, `그제 밤부마켓 20`,
  `9/6 코스트코 85.89`, `2026-08-28 코스트코 190.05`. 날짜는 문장 어디에 있어도 된다.
  지난달 날짜로 적으면 그 달 기준으로 결산해 회신한다("오늘 남은" 대신 그 달 실행·잔액).
- 분류 버튼은 6시간 캐시 + Log 복구라 늦게 눌러도 된다. 같은 버튼을 두 번 눌러도 한 번만 기록된다.
- 같은 고정 항목을 한 달에 두 번 보내면 두 번째 행이 생긴다. 덮어쓰지 않는다.
- 아침 요약은 전부 🟢 이면 한 줄만 온다. 일요일 저녁에 주간 결산, 말일에 점수 3개가 온다.

### d. 웹앱
- Today 헤드라인이 "오늘 남은 돈" 이다. 쓰면 바로 줄어든다. 저축 진행과 비상금 카드가 있다.
- 빠른 입력이 봇과 같은 규칙으로 고정 항목을 확정한다.
- 편집은 바뀐 셀만 쓴다. 두 사람이 동시에 다른 열을 고쳐도 서로 되돌리지 않는다.
- 부채 화면은 이자를 반영한 상환 종료와 "이율 높은 것 먼저" 를 보여 준다. 자산 스냅샷에 그날 환율을 적을 수 있다.
- 아이폰 홈 화면 앱에서 로그인 창이 매번 뜨면 알려 달라. 토큰을 sessionStorage 에 두어 줄였지만 실기기 확인이 필요하다.

---

## 부록 — 편집기에서 실행하는 함수와 파일

Apps Script 편집기 왼쪽 파일 목록에서 파일을 고른 뒤, 상단 함수 드롭다운에서 함수를 선택해 실행한다.
편집기는 `.js` 를 `.gs` 로 표시하므로 `Setup.js` 는 `Setup.gs` 로 보인다.

### 설치·설정

| 함수 | 파일 | 하는 일 |
|---|---|---|
| `runSetupAll` | `Setup.gs` | 탭 생성 + 시드 + Monthly_View·Dashboard 그리기. 최초 1회 |
| `setupSheet` | `Setup.gs` | 탭과 헤더만 맞춘다. 새 열이 생겼을 때 실행 |
| `applyPersonalDefaults` | `PersonalSeed.gs` | 우리 집 세부예산·고정 항목·부채를 시트에 반영 |
| `checkPaydays` | `PersonalSeed.gs` | 2주급 급여일을 1년치 로그로 확인. 시트를 건드리지 않는다 |
| `setEnvelopes` | `Setup.gs` | 세부예산 목록 변경 |
| `applyBudgetAmounts` | `Setup.gs` | 특정 월의 세부예산 예산 설정 |
| `clearConfigCache` | `Config.gs` | Config 값을 바꾼 직후 캐시 비우기 |

### 봇 연결

| 함수 | 파일 | 하는 일 |
|---|---|---|
| `setWebhook` | `Telegram.gs` | 웹훅 등록. 웹 앱 배포 후 실행 |
| `getWebhookInfo` | `Telegram.gs` | 웹훅 상태와 마지막 오류 확인 |
| `diagnoseWebhook` | `Telegram.gs` | 회신이 안 올 때 원인 후보를 한 번에 진단 |
| `probeWebappUrl` | `Telegram.gs` | 배포 URL 을 직접 두드려 실제 상태 코드 확인 |
| `webhookWatchdog` | `Jobs.gs` | 밀린 건이 있으면 웹훅을 되살린다. 5분 트리거가 부른다 |
| `drainPendingUpdates` | `Jobs.gs` | 밀린 메시지를 직접 받아 처리하고 웹훅을 다시 붙인다 |
| `deleteWebhook` | `Telegram.gs` | 웹훅 해제 |

### 트리거와 정기 작업

| 함수 | 파일 | 하는 일 |
|---|---|---|
| `installTriggers` | `Jobs.gs` | 트리거 4개 재설치 |
| `dailySummary` | `Jobs.gs` | 아침 요약을 지금 보낸다 |
| `weeklyDigest` | `Jobs.gs` | 주간 결산. 지정 요일이 아니면 아무것도 안 한다 |
| `monthlyOpen` | `Jobs.gs` | 이번 달 예산·예정 행 준비 |
| `monthlyClose` | `Jobs.gs` | 월 마감 보고. 말일이 아니면 아무것도 안 한다 |
| `ensureMonthOpened` | `Jobs.gs` | 이번 달이 안 열렸으면 연다(멱등) |
| `postMonthlyRecurring` | `Recurring.gs` | 이번 달 고정 항목 예정 행 생성 |
| `recomputeIncomePct` | `Recurring.gs` | 수입 비율 항목 다시 계산 |
| `resyncReservedStatuses` | `Recurring.gs` | 예약 행을 지금 `certainty` 기준으로 맞춘다(committed ↔ expected) |

### 화면 다시 그리기

| 함수 | 파일 | 하는 일 |
|---|---|---|
| `buildMonthlyView` | `Views.gs` | Monthly_View 탭 재생성 |
| `buildDashboard` | `Views.gs` | Dashboard 탭 재생성 |

### 선택 기능

| 함수 | 파일 | 하는 일 |
|---|---|---|
| `previewMigrationSource` | `Migration.gs` | 옛 탭의 헤더와 첫 세 행 확인 |
| `migrateAll` | `Migration.gs` | 이관 미리보기. 쓰지 않는다 |
| `migrateAllCommit` | `Migration.gs` | 실제 이관 |
| `migrationReport` | `Migration.gs` | 이관된 행 수 |
| `reconcileLatest` | `Reconcile.gs` | Drive 의 최신 CSV 와 원장 대조 |

`doPost`(`Webhook.gs`)는 Telegram 이 호출하는 진입점이라 편집기에서 직접 실행하지 않는다.
