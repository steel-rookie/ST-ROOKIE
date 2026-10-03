# 공용 데이터 변경 요청 (2026-10-03, `dev` 12ff5ed 기준)

오개념 개수를 세는 규칙과 기록 출처(`origin`)를 정했다. 이 문서는 그 결정에 맞춰 담당자별로 바꿀 곳을 적는다. 결정 원문은 [CLAUDE.md](../CLAUDE.md)의 '오개념 기록'·'데이터 저장'이고, `misconceptions` 테이블 담당은 수민이다.

## 결정 요약

- 오개념 **개수는 체크포인트 기록(`source = 'checkpoint'`)만으로 센다.** 행 수가 아니라 개념 수(`COUNT(DISTINCT concept_id)`, `users.id` 기준)다.
  - 미해결: 미해결 행이 하나라도 있는 개념의 수.
  - 해결: 체크포인트 오개념이 있었고 지금 미해결 행이 하나도 없는 개념의 수. 미해결 + 해결 = 체크포인트 오개념이 있었던 개념 수.
- 학습 모드 감지(`source = 'learning'`)는 튜터가 참고하는 메모다. 개수에 합치지 않고, 체크포인트 오개념과 비교하지도 않는다. 보여 주려면 체크포인트 목록과 섞지 않고 "튜터가 짚은 개념" **참고 목록**으로 따로 보여 준다.
- 해결 처리는 이미 개념 단위다. 체크포인트에서 개념이 1점으로 확정되면 그 사람의 그 개념 미해결 행이 출처와 상관없이 모두 해결된다(`CheckpointRepository.resolveMisconceptions`). 바꿀 것 없음.
- `attempts`·`misconceptions`에 `origin`(`live` | `seed`, 기본 `live`)을 추가했다(`005_record_origin.sql`). `npm run db:seed-demo`가 만든 시연 기록은 `seed`다. 관리자 화면은 시연을 위해 `seed`도 그대로 센다. `eval:export-human`은 `live`만 내보낸다.

## 1. 관리자 통계: `backend/src/admin/` (viiin2)

### 1-1. `GET /api/admin/trainees`: `trainee-stats.ts`

지금은 두 출처를 합쳐 행 수를 센다([trainee-stats.ts:78](../backend/src/admin/trainee-stats.ts#L78)).

```sql
-- 지금
SELECT user_id, resolved, COUNT(*) AS n FROM misconceptions GROUP BY user_id, resolved
```

다음처럼 바꾼다. 응답 형태 `misconceptions: { open, resolved }`는 그대로 둔다.

```sql
-- 미해결: 미해결 행이 있는 개념 수
SELECT user_id, COUNT(DISTINCT concept_id) AS n
  FROM misconceptions
 WHERE source = 'checkpoint' AND resolved = 0
 GROUP BY user_id;

-- 해결: 체크포인트 오개념이 있었고 지금 미해결 행이 없는 개념 수
SELECT m.user_id, COUNT(DISTINCT m.concept_id) AS n
  FROM misconceptions m
 WHERE m.source = 'checkpoint'
   AND NOT EXISTS (SELECT 1 FROM misconceptions o
                    WHERE o.user_id = m.user_id AND o.concept_id = m.concept_id
                      AND o.source = 'checkpoint' AND o.resolved = 0)
 GROUP BY m.user_id;
```

- 테스트(`backend/test/admin.test.ts`)에 다음 경우를 넣는다.
  - 같은 개념의 체크포인트 오개념 여러 행은 1로 센다.
  - `learning` 행은 세지 않는다.
  - 해결된 뒤 다시 틀린 개념은 미해결에만 센다.
- 관리자 화면에 출처별 개수(대화 중 감지 n / 이해도 확인 m)는 넣지 않는다.

### 1-2. `GET /api/admin/concepts`: `concept-stats.ts`

`open`은 지금 두 출처의 미해결 행 수를 모두 센다([concept-stats.ts:21-26](../backend/src/admin/concept-stats.ts#L21-L26)). 이것을 그 개념에 체크포인트 미해결 오개념이 있는 **사람 수**로 바꾼다.

```sql
(SELECT COUNT(DISTINCT m.user_id) FROM misconceptions m
   JOIN users mu ON mu.id = m.user_id
  WHERE mu.role = 'trainee' AND m.section = a.section
    AND m.concept_id = c.concept_id AND m.source = 'checkpoint' AND m.resolved = 0)
```

- 이에 맞춰 [auth-api.md](auth-api.md)의 "`open`: 신입사원 전체의 미해결 오개념 수(체크포인트·학습 모드 모두)"를 "체크포인트 미해결 오개념이 있는 신입사원 수"로 고친다.
- 같은 줄의 "(시연 기록은 설비 id)"는 지운다. PR 2부터 시연 기록도 루브릭 개념 id를 쓴다. [admin-dashboard.md](admin-dashboard.md)의 `name` 항목에 있는 "설비 id를 쓰는 것은 시연 기록뿐"도 같다.

## 2. 신입사원 대시보드: `GET /api/me/dashboard`·`/api/me/misconceptions`와 `Trainee Dashboard.dc.html` (API·화면 작성 ssoyoum, `frontend/login_ui`는 viiin2 담당)

지금은 두 출처를 최근 순서로 한 목록에 섞고 라벨("대화 중 감지됨"·"이해도 확인")로만 구분한다. '미해결 오개념' 숫자도 두 출처의 미해결 **행 수**다([Trainee Dashboard.dc.html:135-136](../frontend/login_ui/Trainee%20Dashboard.dc.html#L135-L136)).

**API (`backend/src/me/`)**: 응답 항목에 `source`가 이미 있으므로 바꾸지 않아도 된다. 화면에서 나누기 어렵다면 `?source=checkpoint|learning` 필터를 추가해도 된다. 서버가 개수를 같이 내려 주면 관리자 화면과 숫자를 맞추기 쉽다(위 1-1의 SQL을 사용자 한 명으로 좁힌 것).

**화면**

| 영역 | 내용 |
|---|---|
| 오개념 (이해도 확인) | `source = 'checkpoint'`만. **개념별로 묶는다.** 개념 하나에 카드 하나: 상태(미해결/해결됨), 가장 최근 `summary`, 그 답변(`answer_text`). 같은 개념의 이전 기록은 접어 두고 펼치면 최근 순서로 보여 준다. |
| 개수 표시 ('미해결 오개념' 카드) | 위 규칙의 미해결 개념 수. 관리자 화면과 같은 숫자여야 한다. |
| 튜터가 짚은 개념 (참고) | `source = 'learning'`만. 체크포인트 목록과 다른 영역으로 둔다. 개수 배지나 미해결 표시를 붙이지 않고 "대화 중 튜터가 짚은 내용"으로 안내한다. 개념이 해결되면(`resolved = 1`) 숨기거나 흐리게 표시한다. |

- 개념의 상태는 그 개념의 체크포인트 행 중 미해결이 하나라도 있으면 미해결이다.
- 정렬은 `created_at` 기준이다. 체크포인트 행은 판정마다 새로 생기므로 최근 행이 곧 최근 설명이다.
- 문서 [auth-api.md](auth-api.md) '개인 페이지'의 `label` 설명도 위 구분에 맞게 고친다.

## 3. 학습 모드 설계 문서: `docs/learning-mode.md` (ssoyoum)

"대화 중 감지됨" 라벨은 지우지 않는다. 다만 체크포인트 목록에 붙이는 라벨이 아니라, **따로 보여 주는 참고 목록**의 이름으로 바꾼다.

- 결정 사항 표 '개인 페이지' 행
  - 지금: `source`가 `learning`인 오개념은 "대화 중 감지됨" 라벨로 구분한다.
  - 바꿀 문장: `source`가 `learning`인 감지는 체크포인트 오개념 목록·개수와 섞지 않고, "대화 중 감지됨"("튜터가 짚은 개념") 참고 목록으로 따로 보여 준다.
- '개인 페이지 표시' 절
  - 지금: 오개념 목록에서 `source = learning`은 "대화 중 감지됨", `source = checkpoint`는 "이해도 확인"으로 라벨을 붙인다.
  - 바꿀 문장:
    - 오개념 목록과 개수는 체크포인트 기록(`source = checkpoint`)만 쓴다.
    - 학습 모드 감지(`source = learning`)는 "대화 중 감지됨" 참고 목록으로 따로 보여 준다. 튜터가 설명할 때 참고하는 메모이므로 점수·개수에 넣지 않는다.
    - 해결 규칙은 같다. 체크포인트에서 그 개념을 맞히면 학습 모드 메모도 해결되어 튜터가 다시 짚지 않는다.
- '학습자 메모' 절의 출처 라벨(대화 중 감지됨·이해도 확인)은 튜터 프롬프트용이므로 그대로 둔다.

## 이미 반영한 것 (수민)

- `005_record_origin.sql`: `origin` 컬럼을 추가했다. 이전에 만든 시연 기록도 `seed`로 표시한다.
  - 시도: 대화 기록(`attempt_messages`)이 없는 시도. 엔진은 시도를 만들 때 항상 시작 멘트를 남긴다.
  - 학습 모드 오개념: 같은 질문의 대화(`learning_turns`)가 없는 것.
  - 마이그레이션 번호 005를 쓴다. 다른 사람이 005를 쓰고 있으면 알려 달라.
- `db:seed-demo`
  - 시연 기록은 `trainee11`~`20`에만 넣는다. **실제 테스트는 `trainee01`~`10`으로 한다.** 실행하면 01~10에 남은 `seed` 기록도 지운다.
  - 개념을 `loadFinalRubrics()`에서 읽는다. 지금은 루브릭이 제선뿐이라 제선만 채워지고 나머지 섹션은 "미시작"이다. 루브릭이 추가되면 그 섹션도 자동으로 채워진다.
  - 다시 만들 때 `seed` 기록만 지운다.
- 체크포인트 엔진(시작·진행·`sectionProgress`)은 `origin = 'live'` 시도만 읽는다. 시연 기록 때문에 409 "이미 통과한 섹션"이 나지 않는다.
- 학습 모드 오개념 조회(`LearningRepository.openMisconceptions`, 학습자 메모 `buildLearnerNotes`)와 중복 확인(`recordMisconception`)은 `origin = 'live'`만 본다. `backend/src/learning/repository.ts`는 ssoyoum 담당이다. 이 두 쿼리에 조건 한 줄씩만 추가했다.
- `eval:export-human`은 `origin = 'live'`만 내보낸다. `origin`이 없는 예전 DB는 대화 기록이 있는 시도만 내보낸다.
