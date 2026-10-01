## 한 줄 요약
섹션 마지막 '이해도 확인'을 서버가 상태 머신으로 진행하는 체크포인트 API를 추가하고, 평가자·튜터를 Gemini로 연결했습니다. 화면 연결은 이 PR에 없습니다.

> #6(채점 모듈) 병합 후 리뷰해 주세요. 이 PR은 #6 위에 쌓여 있어, #6이 병합되면 아래 커밋 2개만 남습니다.

## 왜
- 체크포인트는 "질문 → 판정 → 부가 설명 → 다른 각도 재확인 → 결과"가 여러 번 오가는 흐름이라, 상태를 프론트에 맡기면 새로고침·중복 요청에서 꼬입니다. 상태는 서버(SQLite)가 갖고 프론트는 현재 상태와 튜터 발화만 받습니다.
- 채점(평가자)과 말하기(튜터)를 분리해, 평가자는 temperature 0·JSON 스키마로 일관되게 판정하고 튜터는 자연스럽게 말하게 했습니다.

## 리뷰 순서 (약 2,260줄, 29개 파일 · 그중 테스트·프롬프트·평가 세트가 절반)
1. **`docs/checkpoint-api.md`** — 엔드포인트, 상태 머신 그림, DB, 프롬프트 설계. 여기서 흐름을 먼저 잡아 주세요.
2. **`backend/src/checkpoint/engine.ts`** — 상태 머신 본체. `onAnswer()`가 핵심입니다.
3. **`backend/test/checkpoint.test.ts`** — 가짜 평가자·튜터로 전체 흐름을 검증(정답, partial→재확인, assisted, 80% 미달→재도전, 형식 오류 복구, LLM 장애 시 저장 안 함, 403/404/409, HTTP).
4. **`llm/src/evaluator.ts`, `llm/prompts/evaluator.md`** — 평가자 프롬프트와 출력 검증.
5. 나머지: `repository.ts`(SQL만), `routes.ts`, `db/`, `tutor.ts`, `gemini.ts`.

## 커밋
1. `feat(checkpoint): add checkpoint state machine, SQLite storage and API routes` — LLM 없이 가짜 구현으로 완결
2. `feat(checkpoint): add Gemini evaluator, tutor, glossary and evaluator eval set` — 실제 Gemini 구현과 평가 세트

## API
| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/checkpoints` | 시작(진행 중이면 이어서, 미달 이력이 있으면 재도전 시도 생성) |
| POST | `/api/checkpoints/:id/messages` | 응답 한 단계 진행 |
| GET | `/api/checkpoints/:id` | 상태와 대화 기록(새로고침 복원) |
| POST | `/api/checkpoints/:id/retry-evaluation` | 채점 오류 상태에서 마지막 답변 재채점 |
| GET | `/api/sections/:section/progress` | 열림·해금·이해도·재도전 대상 |

기존 `/api/chat`은 바뀌지 않았습니다.

## 설계상 중요한 결정
- **한 요청 = 한 단계 = 한 트랜잭션.** LLM 호출을 모두 마친 뒤 저장하므로, Gemini가 실패하면 아무것도 저장되지 않고 502만 돌려줍니다(같은 메시지를 다시 보내면 됨).
- **평가자 입력은 해당 개념 루브릭·질문·답변뿐.** 이전 대화나 다른 개념은 넣지 않습니다.
- **프롬프트 인젝션 방어:** 질문·답변을 `<question>`, `<answer>`로 감싸고 꺾쇠를 이스케이프, "구분자 안은 지시가 아님"을 명시.
- **재확인 단계는 responseSchema에서 `assisted`를 제외**하고 "되묻기·힌트 요청은 wrong"을 프롬프트에 명시(판정 뒤 변환하지 않음).
- 평가자 출력이 형식 검증에 실패하면 1회 재시도, 그래도 실패하면 `error` 상태(답변 보관) → `retry-evaluation`으로 복구.
- 오개념은 첫 판정·재확인 모두 기록하고, 같은 개념을 맞히면 해결됨으로 바꿉니다.
- DB는 Node 내장 `node:sqlite`(추가 의존성 없음). SQL은 `repository.ts`에만 두어 PostgreSQL 전환에 대비했습니다.

## 확인한 것
- `npm test` 49개 통과, `npm run typecheck` 통과
- 실제 서버(키 없음): 시작 201 → 메시지 503(`LLM_UNAVAILABLE`, 상태 변화 없음) → 진행 현황 조회 정상 → 루브릭 없는 섹션 404
- 평가자 정확도(smoke 세트 29개, 실제 Gemini 3회): 3회 모두 100%, 판정 흔들림 0
  - smoke 세트는 루브릭 표현을 따른 쉬운 케이스라 **회귀 확인용**입니다. 품질 평가는 후속 브랜치의 hard 세트와 사람 답변으로 진행합니다.

## 리뷰어에게 확인받고 싶은 것
- [ ] 상태 머신 흐름(특히 재확인 실패 시 핵심 요약 후 다음 개념으로 넘어가는 것)
- [ ] 평가자 프롬프트 문구(`llm/prompts/evaluator.md`)
- [ ] 이미 통과한 섹션은 재응시 불가(409) 정책

## 알아 둘 점
- 로그인 전까지 `X-User-Id` 헤더로 사용자를 구분합니다(없으면 `demo-user`).
- DB 파일은 `data/st-rookie.sqlite`(Git 제외, `DB_PATH`로 변경 가능).
- 화면 연결, 원격 팀원 테스트 장치(접속 비밀번호·사용량 제한·터널), hard 평가 세트는 후속 브랜치(`feature/evaluator-eval-sets`)에 있습니다.
