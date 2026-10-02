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
3. 평가자 LLM이 사용자 답변을 판정해 JSON을 돌려준다.
   ```json
   {
     "concept_id": "string",
     "verdict": "correct | partial | wrong | assisted",
     "misconception": "string | null",
     "explain_from": "string | null"
   }
   ```
4. `correct`가 아니면(`partial`, `wrong`, `assisted`) `explain_from`부터 부가 설명을 한 뒤 **다른 각도의 질문으로 한 번** 재확인한다. 재확인은 개념당 1회뿐이다.

평가자는 `content/rubrics/final/`만 읽는다. `draft/`는 읽지 않는다.

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
- 오개념 내용(설명·답변 원문)은 개인 페이지에서 **본인 것만** 보인다. 관리자 화면에는 사람별 미해결·해결 **개수만** 나온다.
- 학습 모드에서 감지된 오개념도 기록한다(점수 반영 없음).
- 관리자 화면은 신입사원 통계 조회만 한다(아래 "계정과 관리자").

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
- 현재 `final/01_제선.json`은 `reviewed: false`인 임시 루브릭이다. `section.md`가 생기면 그 문서를 근거로 다시 만든다.

## 계정과 관리자

- 역할은 `trainee`(신입사원)와 `admin`(관리자). 회원가입은 항상 `trainee`. API는 [docs/auth-api.md](docs/auth-api.md), 코드는 `backend/src/auth/`.
- 시연 계정 `trainee01`~`04`, `admin01`은 서버 시작 때 만든다(`DEMO_ACCOUNTS=off`로 끔).
- 아이디·비밀번호 찾기는 이름 + 사번으로 본인 확인을 한다(메일 발송 없음). 시연·사내용 수준이다.
- 관리자는 `GET /api/admin/trainees`로 신입사원별 섹션 이해도·통과 여부·시도 횟수·오개념 개수·마지막 학습일을 본다(`backend/src/admin/`). 체크포인트 테이블(`attempts`, `misconceptions`)이 없으면 계정 목록만 준다.
- 화면: `frontend/login_ui/My Page.dc.html`, 서버의 `/login`. 관리자로 로그인하면 개인 학습 기록 대신 통계를 보여 준다.
- `npm run db:seed-demo [seed]`: 시연 신입사원(`trainee01`~`04`)의 체크포인트 기록을 지우고 무작위로 다시 만든다(`backend/src/db/demo-records.ts`). 테이블은 `feature/checkpoint-api`와 같은 `001_checkpoint.sql`, 점수는 `scoring.ts` 규칙. 다른 계정의 기록은 건드리지 않는다.

## 튜토리얼

- 첫 로그인 때 driver.js 코치마크로 화면을 안내한다.
- 연습 질문 1개를 낸다. 점수에 포함하지 않는다.

## 데이터 저장

- SQLite로 시작한다. PostgreSQL로 옮길 수 있게 SQLite 전용 문법·타입에 의존하지 않는다.
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
- 관리자 통계 화면을 만든다(처음 설계의 "관리자 화면 없음"을 바꿈). 오개념은 개수만 보여 준다.
- LLM: Gemini를 유지한다. 평가자는 Gemini `responseSchema`로 판정 JSON 형식을 강제한다.
- 체크포인트 결과 차트: 개념별 가로 막대(맞음/부분/틀림) + 전체 이해도 게이지(80% 기준선 표시).

## 미정 사항

현재 없음. 새로 생기면 여기에 적고, 구현할 때 추측하지 말고 팀에 확인한다.

## 테스트

- `npm test`: 빌드 후 `backend/test/*.test.ts`를 `node:test`로 실행한다.
- `npm run typecheck`: 타입 검사.
- 소스를 지우거나 옮긴 뒤 테스트가 이상하면 `.build/`를 지우고 다시 실행한다(이전 빌드 결과가 남는다).
