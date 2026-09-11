# STATUS.md — 진행 상태

## 현재 단계
- **P0 완료** (2026-09-11): 저장소 뼈대, CLAUDE.md, .gitignore, ARCHITECTURE.md, SHEET_SCHEMA.md, ADR-0001~0003, resume.md, claude/prompts/P0.md.

## 다음 할 일
- **P1**: 시트 스키마 생성 스크립트 (`apps-script/src/{Config,Setup,Sheet}.js`, `appsscript.json`, `.clasp.json.example`, `package.json`, `docs/SETUP.md`). 프롬프트는 사용자가 제공한 P1 원문을 `claude/prompts/P1.md` 로 저장하며 시작한다.

## 완료 이력
| 단계 | 커밋 | 날짜 |
|---|---|---|
| P0 | P0: 저장소 뼈대와 설계 문서 | 2026-09-11 |

## 미결 사항
- `docs/decisions/ADR-0003-open-decisions.md` 참고: 봉투 구성, 월말 잔액 처리, 유류비 분류.

## 사용자 사전 준비 체크리스트 (저장소에 값 기록 금지)
- [ ] Google Sheet 생성 및 아내 계정 공유 → SPREADSHEET_ID
- [ ] Apps Script 프로젝트 생성 → Script ID
- [ ] @BotFather 로 봇 생성 → BOT_TOKEN
- [ ] 두 사람의 Telegram user ID
- [ ] WEBHOOK_SECRET 생성 (`openssl rand -hex 24`)
- [ ] (선택) clasp 설치·로그인
