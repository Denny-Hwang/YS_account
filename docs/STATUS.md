# STATUS.md — 진행 상태

## 현재 단계
- **P12 완료** (2026-09-15): 원장 달력 뷰, 예정/집행 상태 구분, 금액 확정 고정비 예산 선반영(`committed` 상태).
  웹훅이 조용히 요청을 버리지 않게 하고 `diagnoseWebhook` 진단 함수 추가.
  검증: `apps-script` 테스트 102개, `webapp` 테스트 8개, 타입 검사·빌드 통과.
- **P11 완료** (2026-09-13): 리뷰 보고서(`docs/REVIEW-2026-09-13.md`)의 제안을 전부 반영.
  고정 항목 재확정 덮어쓰기 수정, 취소 정확화, "오늘 남은 돈" 헤드라인과 신호등, 분류 버튼 만료 제거,
  금액 후보 선택, 월 시작 보정, 시트 뷰 기준 통일, 웹앱 부분 쓰기, 먼저 저축·연간비·환불·부채 상각·비상금,
  예외 기반 아침 요약·주간 결산·월 마감 점수·봉투 이동, PR CI, 개인 정보 제거.
- **P0 ~ P10 완료** (2026-09-11 ~ 13).
- 검증: 비밀값 grep 빈 결과.

## 다음 할 일
0. **P12 반영.** `clasp push` → 새 버전 배포 → `Setup.gs` 의 `setupSheet`(Recurring 에 `certainty` 열 추가)
   → `Recurring.gs` 의 `resyncReservedStatuses`(이미 만들어진 예약 행 보정) → `Views.gs` 의 `buildMonthlyView`·`buildDashboard`(수식 갱신).
1. **실제 연결.** `docs/SETUP.md` 를 순서대로 따라 시트·봇·트리거·웹앱을 붙인다.
   기존 시트가 있다면 `setupSheet` 을 한 번 실행해 `Debts.recurring_id`, `Assets.fx_usd_krw`, Config 새 키가 붙게 한다.
   `installTriggers` 를 다시 실행해 `weeklyDigest` 트리거를 추가한다. 배포는 "새 버전" 으로.
2. **한 달 사용 뒤 점검.** 아침 요약이 한 줄로 오는지, 빨강 회신의 "예비비에서 옮기기" 버튼이 쓸모 있는지,
   주간 결산 요일(`Config.weekly_digest_day`)이 맞는지 본다.
3. **기존 가계부 이관.** `previewMigrationSource` → `MIGRATION_MAP` → `migrateAll` → `migrateAllCommit`.
4. 아이폰 홈 화면 앱에서 구글 로그인 창이 매번 뜨는지 확인한다(REVIEW L6). 토큰을 sessionStorage 에 두어 줄였지만 실기기 확인이 필요하다.

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
| P10 | P10: 웹앱 시각화 개편과 예상 수입 | 2026-09-13 |
| 리뷰 | 저장소 무결성 검증과 재무 관점 서비스 리뷰 보고서 | 2026-09-13 |
| P11 | P11: 리뷰 제안 전부 반영 | 2026-09-13 |
| P12 | P12: 원장 달력 뷰와 금액 확정 고정비 예산 선반영 | 2026-09-15 |

## 미결 사항
- 없음. ADR-0003 의 세 항목이 모두 결정됐다.
- 저장소가 공개라면 이력에 남은 예전 스크린샷·시드 값은 지울 수 없다. 비공개 전환은 사용자 판단.

## 사용자 사전 준비 체크리스트 (저장소에 값 기록 금지)
- [ ] Google Sheet 생성 및 배우자 계정 공유 → SPREADSHEET_ID
- [ ] Apps Script 프로젝트 생성 → Script ID
- [ ] @BotFather 로 봇 생성 → BOT_TOKEN
- [ ] 두 사람의 Telegram user ID
- [ ] WEBHOOK_SECRET 생성 (`openssl rand -hex 24`)
- [ ] (선택) clasp 설치·로그인
