# SETUP.md — 수동 설치 절차

이 문서의 값(스프레드시트 ID, 봇 토큰 등)은 **저장소에 절대 커밋하지 않는다.**
모두 Apps Script `Script Properties` 에만 저장한다.

## 사전 준비 (Claude Code 실행 전)
1. 빈 Google Sheet 생성 → URL 의 `/d/<SPREADSHEET_ID>/` 기록. 아내 계정에 **편집자**로 공유.
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
3. `Budgets` 탭 → 이번 달 각 봉투의 `amount` 를 실제 예산으로 입력. 월말 이월이 필요하면 `carryover` 를 `carry` 로.
4. `Recurring` 탭 → 시드된 9개 항목의 `expected_amount`, `due_day` 를 실제 값으로 수정.
   `R08 십일조` 는 `income_pct:7` 규칙이라 금액을 비워 둔다. `R09 부채상환` 금액도 직접 입력한다.
5. `Config.envelopes` 를 바꿨다면 `setupSheet` 을 한 번 더 실행해 드롭다운을 갱신한다.

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

> 코드를 수정할 때마다 `배포 관리` → 기존 배포의 연필 아이콘 → 버전 `새 버전` 으로 갱신해야
> 웹훅 URL 이 그대로 유지된다. `새 배포` 를 다시 만들면 URL 이 바뀌므로 `setWebhook` 을 다시 실행해야 한다.

### b. 사람 이름 매핑 (선택)
`Config` 탭에 `name_<telegram_id>` 키를 추가하면 원장의 `payer` 열에 그 이름이 들어간다.
예: key `name_11111111`, value `성주`. 없으면 숫자 ID 가 그대로 들어간다.

### c. 웹훅 등록
편집기에서 `setWebhook` 함수를 실행한다.
`WEBAPP_URL` 과 `WEBHOOK_SECRET` 을 읽어 `<WEBAPP_URL>?token=<WEBHOOK_SECRET>` 으로 등록한다.
실행 로그에 "웹훅 등록 완료" 가 찍히면 성공이다. 실패하면 `Log` 탭을 본다.
해제는 `deleteWebhook` 이다.

### d. 동작 확인
1. 봇에게 `코스트코 1.00` 을 보낸다.
   - `Transactions` 탭에 `status=active`, `envelope=식료품` 행이 생긴다.
   - `Log` 탭에 원문과 파싱 결과가 남는다.
   - 봇이 `식료품 잔액 ... · 남은 N일 × $.../일 · 계획 대비 ...` 로 회신한다.
2. 봇에게 `취소` 를 보낸다. 방금 행의 `status` 가 `deleted` 로 바뀌고 회신이 온다.
   행이 사라지지 않는 것이 정상이다(append-only + soft delete).
3. 사전에 없는 가맹점(`처음가게 5`)을 보내면 봉투 선택 버튼이 온다.
   버튼을 누르면 `Merchants` 에 학습되고 원장에 기록된다.
4. `얼마 남았어` 를 보내면 봉투별 상태가 한 줄씩 온다.

### 문제가 생기면
- 봇이 아무 반응이 없다 → `Log` 탭 확인. 비어 있으면 token 불일치이거나 `allowed_telegram_ids` 누락이다.
- `Config.allowed_telegram_ids` 에 본인 ID 가 콤마로 정확히 들어갔는지 확인한다(공백 무방).
- Config 값은 5분 캐시된다. 바꾼 직후라면 잠시 기다리거나 `clearConfigCache` 를 실행한다.

---

## P4 — 시간 트리거 설치

### a. 트리거 설치
편집기에서 `installTriggers` 를 실행한다. 기존 트리거를 모두 지우고 세 개를 새로 등록한다(멱등).

| 함수 | 주기 | 하는 일 |
|---|---|---|
| `dailySummary` | 매일 `Config.daily_summary_hour` 시 | 어제 유동비 합, 봉투별 상태, 오늘 결제일인 고정비 안내 |
| `monthlyOpen` | 매월 `Config.month_start_day` 일 06시 | 예산 시드(전월 복사 + carry 이월), 고정비 expected 생성, 요약 |
| `monthlyClose` | 매일 21시 | **말일에만** 동작. 봉투 결산, 고정비 편차, 미확인 고정비 보고 |

> `monthlyClose` 를 매일 21시로 두고 말일 여부를 코드에서 판정한다.
> 달마다 말일이 28/29/30/31 로 달라지는데 Apps Script 의 월간 트리거는 고정된 날짜만 받기 때문이다.
> 말일이 아닌 날에는 아무 메시지도 보내지 않는다.

편집기 좌측 `트리거` 화면에서 세 개가 보이는지 확인한다.

### b. 동작 확인
1. `dailySummary` 를 수동 실행한다. 봇이 `allowed_telegram_ids` 전원에게 요약 메시지를 보낸다.
2. `postMonthlyRecurring` 을 수동 실행한다. `Transactions` 에 `status=expected`, `source=recurring` 인
   고정비 행이 생긴다. 한 번 더 실행해도 행이 늘지 않아야 한다(멱등).
3. 봇에게 `관리비 212` 를 보낸다. 위 expected 행이 `confirmed` 로 바뀌고 금액이 212 로 덮어써진다.
   새 행이 생기지 않는 것이 정상이다.
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
| 유동비 봉투 | 49행 | 봉투별 예산·실행·잔액·남은 일수·일일 가용액 |
| 카테고리 비중 | 62행 | 카테고리별 합계와 비중(%) |
| 원장 | 86행 | 그 달 `status≠deleted` 행 전부(날짜 내림차순) |

> 블록 1·2·3·4 는 각각 20/20/10/20 행을 쓴다. Recurring 정의나 봉투가 그보다 많아지면
> `MV_ROWS` 의 행 수를 늘리고 `buildMonthlyView` 를 다시 실행한다.

### Dashboard
- A1 블록: 최근 12개월 수입·지출·순저축 (오늘 기준으로 자동 이동)
- F1 블록: 부채 목록과 원금 합계
- A18 블록: 목표별 진행률. 현재 자산은 `Assets` 의 **최신 스냅샷 날짜** 행 합계를 USD 로 환산한 값
- 우측: 최근 12개월 수입·지출 막대 차트

`Assets` 에 스냅샷을 추가할 때는 같은 `snapshot_date` 로 계좌별 행을 넣는다.
진행률은 그 날짜의 잔액 합계를 기준으로 계산한다.
