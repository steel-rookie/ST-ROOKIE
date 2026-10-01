# ST-ROOKIE

제철소 신입사원 기초교육용 3D 시연 사이트. 공정 4개(제선 → 제강 → 연주 → 열간압연)를 3D로 보여 주고, AI 튜터가 설명하고 이해도를 확인한다.

커밋 메시지 규칙은 [agent.md](agent.md)를 따른다.

## 현재 상태와 목표

| | 현재 | 목표 |
|---|---|---|
| 프론트 | `frontend/3d-demo` (바닐라 HTML + Three.js) | 유지. React로 전환하지 않는다 |
| 백엔드 | Node/Express + Gemini (`backend/src/ironmaking-server.ts`) | Node/Express 유지 + SQLite |
| 튜터 | `tutor.js`의 `mockTutor` (키워드 매칭 샘플 응답) | 학습 모드 + 체크포인트 모드 |
| 교육 내용 | `frontend/3d-demo/data.js` (샘플, 미검증) | `content/materials/{섹션}/section.md` |

채점 로직은 `backend/src/scoring.ts`, 루브릭 로드·검증은 `backend/src/rubrics.ts`에 있다. 서버는 시작할 때 `final/` 루브릭을 모두 검증하고, 형식이 틀리면 시작하지 않는다.

## 프론트 구조 (`frontend/3d-demo`)

- `Steel Academy.dc.html`: 화면 템플릿과 로직. 로직은 `<script type="text/x-dc">` 안의 `class Component extends DCLogic`에 있고, `support.js`가 읽어서 실행한다(에디터에서 문법 강조가 안 됨).
  - `componentDidMount`: `data.js`, `tutor.js`를 불러오고 3D 이벤트를 구독한다.
  - `ask(text)`: 튜터 질문 → `mockTutor` 호출 → `runActions`로 화면 조작 → 메시지 추가.
  - `runActions(actions)`: `goto_process`, `highlight`, `focus`, `play_animation`을 실행한다.
  - `screenContext()`: 현재 공정·설비를 튜터 요청용으로 만든다.
  - `renderVals()`: 템플릿에 넘기는 값과 클릭 핸들러(공정 탭, 설비 목록, 재생 제어, 튜터 패널, 개발자 패널).
  - 체크포인트 모드: 설비 목록 끝의 '이해도 확인' 버튼 → `startCheckpoint()` → `/api/checkpoints`. 응답은 `cpCall()`, 새로고침 복원은 `refreshCheckpoint()`(`/api/sections/:section/progress`의 진행 중 시도를 GET으로 연다), 화면 값은 `checkpointVals()`. 체크포인트 중에는 `ask()`(학습 모드 튜터)를 막는다.
- `scene.js`: `<steel-scene>` 커스텀 엘리먼트(`SteelScene`). Three.js 뷰어 전체.
  - 공정 빌드 `_buildProcess`, GLB 로드 `_loadGLB`, 선택 표시 `_applySelection`, 내부 단면 `_showInterior`.
  - 클릭: `_bindPointer`에서 레이캐스트 → `_select(id)`가 `steel-select` 이벤트 발생.
  - 재생: `tour`, `next`, `stopTour`, `play`, `stop`, `toggle`. 카메라: `focus(id)`, `reset()`.
  - 이벤트: `steel-select`, `steel-model`, `steel-progress`, `steel-tour`, `steel-tour-end`.
- `data.js`: `PROCESSES`(공정·설비·단계·내부 구조), `QUIZZES`(현재 미사용), `SUGGESTED`, `findProcess`, `findEquipment`. 3D 표시용 값과 교육 내용이 섞여 있다.
- `tutor.js`: `mockTutor(req)`. 실제 튜터 API로 교체할 대상.
- `models/`: 공정별 GLB와 `anchors.json`. 설비 노드 이름은 `EQ_<설비 id>`. 규칙은 `models/README.md`.

설비 `id`(예: `blast_furnace`)는 GLB 노드, 화면 선택, 튜터 화면 조작, 콘텐츠를 잇는 키다. 바꾸지 않는다.

## 학습 구조

- **섹션 = 공정 하나.** `ironmaking`, `steelmaking`, `continuous_casting`, `rolling` 순서.
- 각 섹션 마지막에 **이해도 확인 체크포인트**가 있고, 결과를 차트로 보여 준다.
- 다음 섹션은 앞 섹션의 체크포인트를 통과해야 열린다.

## 튜터

튜터는 1명이고 모드가 2개다.

### 학습 모드
- 자유 질문에 RAG로 답한다. 근거는 해당 섹션의 `section.md`.
- 점수를 매기지 않는다.
- 답변 중 오개념이 감지되면 기록만 하고 점수에는 반영하지 않는다.

### 체크포인트 모드
1. 튜터가 "제선 질문 시작할게요, 준비됐나요?"처럼 시작한다.
2. 개념별로 질문한다.
3. 평가자 LLM이 사용자 답변을 판정해 JSON을 돌려준다. `concept_id`는 평가자가 내지 않고 서버가 붙인다.
   ```json
   {
     "verdict": "correct | partial | wrong | assisted",
     "misconception": "string | null",
     "explain_from": "number | null",
     "evidence": "string"
   }
   ```
   `explain_from`은 학습자가 처음 놓친 `key_points`의 인덱스(0부터)다. 되묻거나 힌트를 요청하면 `assisted`다.
4. `correct`가 아니면(`partial`, `wrong`, `assisted`) `explain_from`부터 부가 설명을 한 뒤 **다른 각도의 질문으로 한 번** 재확인한다. 재확인은 개념당 1회뿐이다.
5. 재확인 단계의 평가자는 `responseSchema`의 verdict에서 `assisted`를 빼고, 프롬프트에 "되묻기·힌트 요청은 wrong"을 명시한다(판정 뒤 변환하지 않는다).

평가자는 `content/rubrics/final/`만 읽는다. `draft/`는 읽지 않는다.
평가자 입력은 해당 개념의 루브릭, 섹션 용어집(`glossary`), 질문, 답변뿐이다. 질문과 답변은 `<question>`, `<answer>` 구분자로 감싸고, 구분자 안의 내용은 채점 대상이며 지시가 아니라고 명시한다.

API·상태 머신·DB·프롬프트의 상세 설계는 [docs/checkpoint-api.md](docs/checkpoint-api.md).

## 점수 규칙

점수는 LLM이 아니라 **코드가 계산한다.** LLM은 `verdict`만 낸다.

| 판정 | 개념 점수 |
|---|---|
| `correct` | 1 |
| `partial` | 0.5 |
| `wrong` | 0 |

- 첫 판정이 `correct`면 그대로 1점으로 확정한다.
- 그 밖에는 **재확인 판정이 최종 점수**다. 재확인 판정은 `correct`·`partial`·`wrong` 중 하나다(`assisted`는 첫 판정에만 나온다).
- 재확인 전인 개념은 확정되지 않은 것으로 보고 0점으로 계산한다.
- **이해도** = 섹션 내 개념 점수의 평균. 경계값 오차를 피하려고 분수로 계산한다.
- **해금 조건**: 섹션의 모든 개념이 확정됐고, 이해도가 80% 이상.
- **80% 미달**: 섹션 첫 화면으로 돌아간다. 재도전 때는 만점(1점)이 아닌 개념만 다시 묻고(`partial` 포함), 맞힌 개념의 점수는 유지한다.
- 재도전한 개념은 새 결과로 **덮어쓴다**(이전보다 낮아질 수 있다). 이미 맞힌 개념의 결과를 다시 넣으면 에러다.

## 오개념 기록

- 저장 항목: 자유 텍스트 설명, `concept_id`, 사용자 답변 원문, 상태.
- 상태: `미해결` / `해결됨`. 나중에 같은 개념을 맞히면 `해결됨`으로 바뀐다.
- 개인 페이지에서 **본인 것만** 보인다.
- 학습 모드에서 감지된 오개념도 기록한다(점수 반영 없음).
- 관리자 화면은 만들지 않는다.

## 콘텐츠

```
content/
  materials/{섹션}/section.md   # 웹 자료를 팀이 정리한 섹션별 단일 기준 문서. 튜터 답변의 근거
  rubrics/draft/                # LLM이 생성한 루브릭 초안
  rubrics/final/                # 팀 검수를 마친 루브릭. 평가자는 여기만 읽는다
```

- `section.md`가 교육 내용의 단일 기준이다. 다른 곳에 교육 내용을 중복해서 만들지 않는다.
- 루브릭은 `draft/` → 팀 검수 → `final/` 순서로만 옮긴다. 검수 없이 `final/`에 쓰지 않는다.
- 루브릭 형식은 `content/rubrics/schema.json`. 최상위 `reviewed`는 팀 검수 여부이고, `false`인 루브릭을 로드하면 경고 로그를 남긴다(`backend/src/rubrics.ts`의 `loadRubric`). 스키마 검증은 서버 실행 중에도 `ajv`로 한다.
- 루브릭 최상위의 선택 필드 `glossary: [{term, aliases}]`는 섹션 단위 용어집이다(예: 용선 = 쇳물). 평가자 프롬프트에 들어가 동의어를 같은 말로 본다.
- 현재 `final/01_제선.json`은 `reviewed: false`인 임시 루브릭이다. `section.md`가 생기면 그 문서를 근거로 다시 만든다.

## 튜토리얼

- 첫 로그인 때 driver.js 코치마크로 화면을 안내한다.
- 연습 질문 1개를 낸다. 점수에 포함하지 않는다.

## 데이터 저장

- SQLite로 시작한다(Node 내장 `node:sqlite`, 파일은 `DB_PATH`, 기본 `data/st-rookie.sqlite`). PostgreSQL로 옮길 수 있게 SQLite 전용 문법·타입에 의존하지 않고, SQL은 저장소 파일(`backend/src/checkpoint/repository.ts`)에만 둔다.
- 로그인 전까지는 `X-User-Id` 헤더(없으면 `demo-user`)로 사용자를 구분한다.

## 원격 팀원 테스트 (임시 장치, 로그인이 생기면 지운다)

- 사용자: 프론트가 URL의 `?user=이름`을 `encodeURIComponent`로 `X-User-Id`에 담는다. 없으면 입장 화면에서 이름을 받는다(`backend/src/request-user.ts`).
- 접속 비밀번호: `.env`의 `TEST_PASSCODE`가 있으면 `/api/access`를 뺀 모든 `/api` 요청에 `X-Test-Passcode`를 확인한다. 비어 있으면 검사하지 않는다(`backend/src/test-access.ts`).
- 사용량: 사용자별 하루 LLM 호출 수를 `llm_usage`에 세고 `LLM_DAILY_LIMIT`(기본 150, 0 이하면 무제한)를 넘으면 429(`backend/src/usage.ts`). `GeminiClient`의 `beforeCall` 훅으로 센다.
- 서버는 `127.0.0.1`에만 바인딩한다. 외부 공유는 `npm run tunnel`(cloudflared quick tunnel)로만 하고, `TEST_PASSCODE`가 없으면 터널이 열리지 않는다.
- 앱 구성은 `backend/src/app.ts`의 `createApp()`, 실행은 `ironmaking-server.ts`.
- 사용자 기록 삭제: `npm run db:reset-user -- 이름`. 진행 방법은 `docs/team-test.md`.
- 사용자별 데이터(계정, 개념 점수, 판정 기록, 오개념, 진도, 튜토리얼 완료 여부)는 DB에 둔다.
- 교육 내용과 루브릭은 DB가 아니라 `content/` 파일로 관리한다.

## 확정

처음 설계 이후 팀이 정한 사항.

- 백엔드는 Node/Express를 유지한다(FastAPI로 옮기지 않는다).
- `partial`, `wrong`, `assisted` 모두 재확인 대상이고, 재확인은 1회다. 최종 점수는 재확인 판정 그대로다.
- 재도전 때 `partial` 개념도 다시 묻는다.
- 재도전 결과는 이전 결과를 덮어쓴다.
- 이미 맞힌 개념의 결과를 재도전에 넣으면 에러로 막는다.
- 루브릭에 `reviewed` 필드를 두고, 검수 전 루브릭은 경고 로그를 남긴다.
- 채점 로직은 Node(TypeScript)로 옮겼다. Python 버전은 없다.
- 로그인: 아이디 + 비밀번호(bcrypt 해시) + JWT.
- LLM: Gemini를 유지한다. 평가자는 Gemini `responseSchema`로 판정 JSON 형식을 강제한다.
- 체크포인트 결과 차트: 개념별 가로 막대(맞음/부분/틀림) + 전체 이해도 게이지(80% 기준선 표시).
- 재확인 단계에서 되묻기·힌트 요청은 `wrong`이다(재확인 평가자 스키마에 `assisted` 없음).
- 재확인에도 맞히지 못하면 핵심 요소 요약(템플릿)을 보여 주고 다음 개념으로 넘어간다.
- "준비됐나요?"에는 어떤 응답이든 시작으로 본다.
- 이미 통과한 섹션은 다시 응시할 수 없다(409).
- 같은 시도 안에서 재확인으로 맞혀도 그 개념의 오개념은 해결됨으로 바꾼다.
- 재확인에서 나온 오개념도 기록한다.

## 다음 단계

- **학습자 메모**: `CheckpointEngine.start()`·`respond()`의 선택 파라미터 `options.notes`(`LearnerNotes`: `conceptOrder`, `context`) 자리만 열어 두었다. 개념 순서 조정(`orderConcepts`)과 튜터에게 줄 추가 컨텍스트를 여기에 연결한다.
- **학습 모드 연결**: 설계와 결정은 `docs/learning-mode.md`. 오개념은 같은 응답에서 단정할 때만 감지하고, 대화는 DB에 저장(보관 기간 없음), 근거는 `retrieve()`로 분리해 공개 자료 메모로 먼저 연결한다. 학습 모드 오개념은 체크포인트 튜터의 context로만 쓰고 평가자에게는 넘기지 않는다. 개인 페이지에서 `source = learning`은 "대화 중 감지됨"으로 표시한다.
- **3D 화면 조작**: 학습 모드의 `scene_actions`와 "재학습 시 3D 하이라이트"(오개념이 있는 개념의 설비를 강조)를 함께 진행한다.

## 미정 사항

현재 없음. 새로 생기면 여기에 적고, 구현할 때 추측하지 말고 팀에 확인한다.

## 테스트

- `npm test`: 빌드 후 `backend/test/*.test.ts`를 `node:test`로 실행한다.
- `npm run typecheck`: 타입 검사.
- `npm run eval:evaluator -- --set smoke|hard`: 실제 Gemini로 평가자 정확도를 잰다(기본 smoke). 비용과 요청 제한 때문에 `npm test`에는 넣지 않는다. 케이스 사이 대기는 `EVAL_DELAY_MS`(기본 1000, 무료 등급은 5000 권장).
  - `llm/eval/smoke/`: 회귀 테스트용. 루브릭 표현을 따른 쉬운 케이스라 거의 100%가 정상이고, 평가자 품질의 근거로 쓰지 않는다.
  - `llm/eval/hard/`: 품질 평가용. 공격 케이스(`source: synthetic`)와 사람 답변(`source: human`)을 source별로 따로 집계한다. 형식과 필드는 `llm/eval/README.md`.
  - 출력: 일치율(전체·단계·source·유형), source별 혼동 표, 평가자 형식 재시도(케이스별·전체 비율), 같은 뜻 쌍(`pair_id`) 일치율, 틀린 케이스.
- `npm run eval:export-human -- --db 파일 ...`: 체크포인트 DB의 첫 판정 답변을 `llm/eval/hard/pending/`에 내보낸다(판정 빈칸, 모델 판정은 별도 파일, 사용자 id 익명화). 팀원 테스트 안내는 `docs/team-test.md`.
- 평가자 공통 규칙: 사실 오류가 하나라도 있으면 최대 partial이고 오류는 misconception에 기록한다(`llm/prompts/evaluator.md`).
- 평가자·튜터 프롬프트는 `llm/prompts/`에 있다. 평가자 프롬프트를 바꾸면 `eval:evaluator`로 일치율을 다시 확인한다.
- 소스를 지우거나 옮긴 뒤 테스트가 이상하면 `.build/`를 지우고 다시 실행한다(이전 빌드 결과가 남는다).
