# STATUS.md — 진행 상태

## 현재 단계
- **P1 완료** (2026-09-11): 시트 스키마 생성 스크립트. `appsscript.json`, `.clasp.json.example`, `package.json`, `src/{Config,Sheet,Setup}.js`, `docs/SETUP.md`.

## 다음 할 일
- **P2**: 파서·분류·예산 계산 순수 모듈과 Node 단위 테스트 (`src/{Parser,Classifier,Budget}.js`, `tests/*.test.js`).

## 완료 이력
| 단계 | 커밋 | 날짜 |
|---|---|---|
| P0 | P0: 저장소 뼈대와 설계 문서 | 2026-09-11 |
| P1 | P1: 시트 스키마 setup 스크립트 | 2026-09-11 |

## 미결 사항
- `docs/decisions/ADR-0003-open-decisions.md` 참고: 봉투 구성, 월말 잔액 처리, 유류비 분류.

## 사용자 사전 준비 체크리스트 (저장소에 값 기록 금지)
- [ ] Google Sheet 생성 및 아내 계정 공유 → SPREADSHEET_ID
- [ ] Apps Script 프로젝트 생성 → Script ID
- [ ] @BotFather 로 봇 생성 → BOT_TOKEN
- [ ] 두 사람의 Telegram user ID
- [ ] WEBHOOK_SECRET 생성 (`openssl rand -hex 24`)
- [ ] (선택) clasp 설치·로그인
