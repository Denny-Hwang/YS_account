# STATUS.md — 진행 상태

## 현재 단계
- **P4 완료** (2026-09-11): 시간 트리거. `src/{Recurring,Jobs}.js`, `docs/SETUP.md` P4 절.

## 다음 할 일
- **P5**: Monthly_View / Dashboard 수식 (`src/Views.js`).

## 완료 이력
| 단계 | 커밋 | 날짜 |
|---|---|---|
| P0 | P0: 저장소 뼈대와 설계 문서 | 2026-09-11 |
| P1 | P1: 시트 스키마 setup 스크립트 | 2026-09-11 |
| P2 | P2: 파서·분류·예산 순수 모듈과 테스트 | 2026-09-11 |
| P3 | P3: Telegram 웹훅과 원장 기록 | 2026-09-11 |
| P4 | P4: 고정비 자동 기장, 아침 요약, 월 마감 | 2026-09-11 |

## 미결 사항
- `docs/decisions/ADR-0003-open-decisions.md` 참고: 봉투 구성, 월말 잔액 처리, 유류비 분류.

## 사용자 사전 준비 체크리스트 (저장소에 값 기록 금지)
- [ ] Google Sheet 생성 및 아내 계정 공유 → SPREADSHEET_ID
- [ ] Apps Script 프로젝트 생성 → Script ID
- [ ] @BotFather 로 봇 생성 → BOT_TOKEN
- [ ] 두 사람의 Telegram user ID
- [ ] WEBHOOK_SECRET 생성 (`openssl rand -hex 24`)
- [ ] (선택) clasp 설치·로그인
