# STATUS.md — 진행 상태

## 현재 단계
- **P0 ~ P9 전부 완료** (2026-09-11). 코드 작업은 계획한 범위를 모두 마쳤다.
- 봇(P1~P4), 시트 뷰(P5), 이관(P6), 웹앱(P7~P8), 선택 기능(P9)이 모두 `main` 에 있다.
- 검증: `apps-script` 테스트 63개 통과, `webapp` 테스트 3개 통과, 타입 검사와 빌드 통과.

## 다음 할 일
1. **실제 연결.** `docs/SETUP.md` 를 순서대로 따라 시트·봇·트리거·웹앱을 붙인다.
   코드는 준비됐지만 아직 한 번도 실제 시트에서 돌지 않았다.
2. **미결 3건 결정.** `docs/decisions/ADR-0003-open-decisions.md`.
   봉투 구성, 월말 이월, 유류비 분류.
3. **기존 가계부 이관.** `previewMigrationSource` 로 헤더를 확인하고 `MIGRATION_MAP` 을 채운 뒤
   `migrateAll` 로 미리 보고 `migrateAllCommit` 으로 옮긴다.
4. 선택 기능은 필요할 때 켠다. 켜지 않아도 나머지가 그대로 돌아간다.

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
| P6 | P6: 기존 월별 탭 이관 스크립트 | 2026-09-11 |
| P7 | P7: 웹앱 MVP | 2026-09-11 |
| P8 | P8: 웹앱 확장 화면 | 2026-09-11 |
| P9 | P9: 분류 보조, 영수증 OCR, CSV 대조 | 2026-09-11 |

## 미결 사항
- `docs/decisions/ADR-0003-open-decisions.md` 참고: 봉투 구성, 월말 잔액 처리, 유류비 분류.

## 사용자 사전 준비 체크리스트 (저장소에 값 기록 금지)
- [ ] Google Sheet 생성 및 아내 계정 공유 → SPREADSHEET_ID
- [ ] Apps Script 프로젝트 생성 → Script ID
- [ ] @BotFather 로 봇 생성 → BOT_TOKEN
- [ ] 두 사람의 Telegram user ID
- [ ] WEBHOOK_SECRET 생성 (`openssl rand -hex 24`)
- [ ] (선택) clasp 설치·로그인
