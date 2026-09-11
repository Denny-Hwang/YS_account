# STATUS.md — 진행 상태

## 현재 단계
- **P3.1 완료** (2026-09-11): Telegram update_id 멱등 처리. `src/Dedupe.js`, Webhook 두 번째 게이트,
  Log 탭 `update_id` 열, `getWebhookInfo`, 회신 호출 안전 래퍼.
- **P5 완료** (2026-09-11): `src/Views.js` (buildMonthlyView, buildDashboard), runSetupAll 연결, `docs/SETUP.md` P5 절.
- P0~P5 전체가 `main` 에 병합되어 있다.

## 다음 할 일
- **사용자 결정 대기**. 다음 중 하나를 고르면 그 단계 프롬프트를 작성한다.
  - **P6 마이그레이션**: 기존 월별 탭 → `Transactions` 이관 스크립트. 열 매핑을 사용자가 제공해야 한다.
  - **P7 웹앱 MVP**: Vite + React PWA, Google Identity Services, Sheets API v4, "오늘" + "원장" 화면, GitHub Pages 배포.
- 코드 작업과 별개로 `docs/SETUP.md` 를 따라 실제 시트·봇 연결을 먼저 끝내는 것을 권한다
  (P1 시트 생성 → P3 웹훅 → P4 트리거 → P5 뷰 확인).
- P3.1 반영분은 `clasp push` 후 `setupSheet` 을 한 번 실행해야 기존 `Log` 탭에 `update_id` 열이 생긴다.
  열이 없는 동안에는 캐시만으로 중복을 거르고, Log 기반 2차 확인은 건너뛴다.
- `docs/decisions/ADR-0003-open-decisions.md` 의 미결 3건(봉투 구성, 월말 이월, 유류비 분류)도 결정이 필요하다.

## 완료 이력
| 단계 | 커밋 | 날짜 |
|---|---|---|
| P0 | P0: 저장소 뼈대와 설계 문서 | 2026-09-11 |
| P1 | P1: 시트 스키마 setup 스크립트 | 2026-09-11 |
| P2 | P2: 파서·분류·예산 순수 모듈과 테스트 | 2026-09-11 |
| P3 | P3: Telegram 웹훅과 원장 기록 | 2026-09-11 |
| P4 | P4: 고정비 자동 기장, 아침 요약, 월 마감 | 2026-09-11 |
| P5 | P5: Monthly_View 와 Dashboard 수식 | 2026-09-11 |
| P3.1 | P3.1: Telegram update_id 멱등 처리 | 2026-09-11 |

## 미결 사항
- `docs/decisions/ADR-0003-open-decisions.md` 참고: 봉투 구성, 월말 잔액 처리, 유류비 분류.

## 사용자 사전 준비 체크리스트 (저장소에 값 기록 금지)
- [ ] Google Sheet 생성 및 아내 계정 공유 → SPREADSHEET_ID
- [ ] Apps Script 프로젝트 생성 → Script ID
- [ ] @BotFather 로 봇 생성 → BOT_TOKEN
- [ ] 두 사람의 Telegram user ID
- [ ] WEBHOOK_SECRET 생성 (`openssl rand -hex 24`)
- [ ] (선택) clasp 설치·로그인
