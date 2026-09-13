# CLAUDE.md — family-budget

## 언어
- 모든 대화, 커밋 메시지, 문서, 코드 주석: 한국어. 식별자(변수/함수/파일명)는 영어.

## 프로젝트 한 줄 요약
Telegram 봇으로 최소 입력 → Google Apps Script 가 파싱·분류해 Google Sheet 원장에 기록
→ GitHub Pages PWA 웹앱에서 "오늘 쓸 수 있는 돈"과 원장 편집 제공.

## Golden Rules (위반 금지)
1. 비밀값(BOT_TOKEN, WEBHOOK_SECRET, SPREADSHEET_ID, Script ID, 개인 Telegram ID, 실제 거래 데이터)은
   저장소에 쓰지 않는다. `.clasp.json`, `.env*` 는 .gitignore 에 있어야 한다. 예시는 `*.example` 로만.
2. 금액·날짜·통화 추출은 규칙 기반(정규식)만 사용한다. LLM 은 분류 보조에만, 그것도 P6 이후.
3. 원장(`Transactions`)은 append-only + soft delete. 행을 물리적으로 삭제하는 코드를 쓰지 않는다.
4. 데이터는 시트 한 곳에만 있다. 월별 탭을 만들지 않는다. 월별 보기는 `Monthly_View` 수식으로만.
5. Apps Script 코드 중 Google 서비스(SpreadsheetApp, UrlFetchApp 등)에 의존하지 않는 순수 로직
   (파서, 분류, 예산 계산)은 별도 파일로 분리하고 Node 에서 단위 테스트한다.
6. 한 단계(P n)의 종료 조건에 도달하면 멈추고 STATUS.md 를 갱신한 뒤 사용자에게 보고한다.
   다음 단계로 자동 진행하지 않는다.
7. 탐색성 작업("분석해봐", "둘러봐")은 하지 않는다. 지시된 파일만 읽고 쓴다.
8. Apps Script 편집기에서 실행할 함수를 안내할 때는 어느 스크립트 파일에 있는지 항상 함께 적는다.
   예: "`Setup.gs` 의 `runSetupAll` 을 실행한다". 전체 목록은 `docs/SETUP.md` 부록에 있다.

## 저장소 구조
- `apps-script/src/*.js` — GAS 코드 (clasp 로 push). 순수 모듈은 `module.exports` 가드 포함.
- `apps-script/tests/*.test.js` — Node 내장 테스트 러너(`node --test`)로 순수 모듈 검증.
- `apps-script/appsscript.json`, `apps-script/.clasp.json.example`
- `webapp/` — Vite + React PWA. `npm test`(공유 모듈 브리지), `npm run build`(타입 검사 포함).
  `apps-script/src` 의 순수 모듈을 빌드 시 ESM 으로 바꿔 그대로 쓴다. 계산 코드를 복사하지 않는다.
- `docs/` — ARCHITECTURE.md, SHEET_SCHEMA.md, SETUP.md, STATUS.md, decisions/ADR-*.md
- `claude/prompts/P*.md` — 단계별 프롬프트 사본. `claude/routines/resume.md` — 재개 프로토콜.

## Resume 프로토콜
세션 시작 시 `docs/STATUS.md` 와 `git log --oneline -20` 을 읽고 현재 단계를 파악한다.
STATUS.md 의 "다음 할 일" 항목부터 시작한다.

## 검증
- 순수 모듈 변경 시 반드시 `cd apps-script && npm test` 통과.
- GAS 전용 파일은 `node --check` 로 문법만 확인.
- 비밀값 유출 점검: 아래 결과가 비어야 한다. 잠금 파일의 무결성 해시는 오탐이라 제외한다.
  ```
  git grep -nE "[0-9]{9,10}:[A-Za-z0-9_-]{35}|AKfycb|1[A-Za-z0-9_-]{40,}" \
    -- ':!*package-lock.json' ':!CLAUDE.md' ':!docs/SETUP.md' ':!claude/prompts/*'
  ```
