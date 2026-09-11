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
