# 학습 모드 시작 안내

학습 모드(자유 질문, 점수 없음) 담당(ssoyoum)을 위한 안내입니다. 체크포인트(이해도 확인)와 병합 충돌 없이 작업할 수 있도록 담당 파일과 규칙을 정해 두었습니다.

## 1. 읽을 문서 (순서대로)

1. [CLAUDE.md](../CLAUDE.md): 프로젝트 전체 규칙. 특히 '프론트 구조', '파일 담당', '튜터 > 학습 모드', '오개념 기록', '데이터 저장'.
2. [docs/learning-mode.md](learning-mode.md): 학습 모드 설계와 이미 정한 결정 사항(오개념 감지 기준, 대화 저장, `retrieve()` 분리, 개인 페이지 표시).
3. [docs/equipment-ids.md](equipment-ids.md): 최종 페이지(v2) 설비 id 24개와 v1·루브릭과의 차이. 화면 조작(`scene_actions`)과 콘텐츠는 이 id를 씁니다.
4. [docs/checkpoint-api.md](checkpoint-api.md): 체크포인트 쪽 API와 상태 머신. 학습 모드가 넘겨줄 학습자 메모(`LearnerNotes`)가 어디에 쓰이는지 볼 때만 필요합니다.
5. [agent.md](../agent.md): 커밋 메시지 형식.

## 2. 담당 파일

| 파일 | 할 일 |
|---|---|
| `frontend/3d-demo/learning-chat.js` | 화면의 학습 채팅. 지금은 `tutor_v2.js`의 가짜 튜터를 부른다. `ask()`를 `/api/chat` 호출로 바꾼다. |
| `frontend/3d-demo/tutor_v2.js` | 가짜 튜터. 실제 API로 바꾼 뒤 지우거나 테스트용으로 남긴다. |
| `llm/src/learning-agent.ts` (새로 만듦) | 학습 모드 Gemini 호출. `llm/src/ironmaking-agent.ts`(기존 `/api/chat`)를 대체한다. |
| `llm/src/retrieval.ts` (새로 만듦) | `retrieve()`: 근거 조각 검색. |
| `llm/prompts/learning*.md` (새로 만듦) | 학습 모드 프롬프트. |
| `backend/src/learning/` | 라우트, 안전 규칙, 대화 저장소, `buildLearnerNotes` 구현. |
| `backend/src/db/migrations/003_*.sql` | 학습 모드 테이블. **001·002는 이미 사용 중**이므로 003부터. |
| 위 파일들의 테스트 (`backend/test/learning-*.test.ts` 등) | |

`backend/src/learning/notes.ts`는 체크포인트와의 **계약**입니다.
- `LearnerNotes` 타입과 `buildLearnerNotes(userId, section)` 시그니처는 고정입니다. 바꿔야 하면 수민과 먼저 합의합니다.
- 함수 본문(지금은 빈 메모를 돌려주는 TODO)은 자유롭게 구현하면 됩니다.

## 3. 건드리지 말 파일

| 파일 | 이유 | 고쳐야 하면 |
|---|---|---|
| `backend/src/checkpoint/`, `llm/src/evaluator.ts`, `llm/src/tutor.ts`, `llm/src/question-check.ts`, `llm/prompts/evaluator.md`, `llm/prompts/tutor-*.md`, `llm/eval/`, `content/rubrics/`, `frontend/3d-demo/checkpoint-test.html` | 체크포인트·평가자·질문 은행·eval (수민 담당) | 수민에게 먼저 알리기 |
| `Steel Academy v2.dc.html`, `data_v2.js`, `scene_v2.js`, `steel-2d*.js`, `models/`, `frontend/login_ui/` | 프론트(viiin2 담당) | HTML에 로드·연결 코드가 더 필요하면 viiin2에게 알리고 그 변경만 작은 PR로 |
| `Steel Academy.dc.html`, `data.js`, `tutor.js`, `scene.js` | 옛 페이지(v1). 고치지 않는다 | - |
| `llm/src/gemini.ts`, `backend/src/scoring.ts`, `content/rubrics/schema.json`, `backend/src/app.ts`, `backend/src/db/database.ts`, `backend/src/checkpoint/types.ts`, `package.json`, `CLAUDE.md` | 공용 | 그 변경만 담은 작은 PR + 팀 공유 |
| `backend/src/db/migrations/001_*.sql`, `002_*.sql` | 이미 적용된 마이그레이션 | 고치지 않고 새 번호로 추가 |

- `backend/src/app.ts`에 학습 모드 라우트를 등록하는 줄은 필요합니다. 라우트 본문은 `backend/src/learning/`에 두고, `app.ts`에는 등록 한두 줄만 추가해 작은 PR로 냅니다.
- 학습 모드 오개념(`misconceptions.source = 'learning'`)은 체크포인트 **튜터의 context로만** 넘깁니다. **평가자에게는 넘기지 않습니다**(`docs/learning-mode.md`).

## 4. 브랜치 규칙

- `dev`에서 새 브랜치를 만듭니다. 이름은 `feature/learning-<내용>`입니다(예: `feature/learning-retrieval`).
- **PR의 base는 항상 `dev`입니다.** PR #9~#11은 앞 PR 브랜치를 base로 쌓아 둔 채 병합되는 바람에 dev에 들어가지 못했습니다. 이걸 정리하느라 PR #13이 따로 필요했습니다.
  - 꼭 PR을 쌓아야 하면, 앞 PR이 병합된 직후 다음 PR의 base를 `dev`로 바꾼 뒤 병합합니다.
- PR은 작게 나눕니다. 예: 저장소(마이그레이션) → 검색 → 에이전트 → 라우트 → 화면 연결.
- 작업 중에 `dev`를 자주 받아 옵니다(`git fetch && git merge origin/dev`).
- 작업 시작 전과 커밋 전에 현재 브랜치를 확인합니다(`git branch --show-current`).
- 새 마이그레이션 번호는 PR을 열기 전에 팀에 알립니다(같은 번호 충돌 방지).
- 커밋 메시지는 [agent.md](../agent.md) 형식을 따릅니다.

## 5. 테스트 방법

준비

```bash
npm ci
cp .env.example .env   # GEMINI_API_KEY 채우기(실제 호출이 필요할 때만)
```

| 명령 | 내용 |
|---|---|
| `npm test` | 빌드 후 `backend/test/*.test.ts` 전부(`node:test`). Gemini를 부르지 않는다. 학습 모드 테스트도 가짜 에이전트로 작성한다. |
| `npm run typecheck` | 타입 검사 |
| `npm start` | 서버(`http://localhost:3000`). 최종 페이지는 `http://localhost:3000/Steel%20Academy%20v2.dc.html` |

- 화면 확인: 위 주소에서 오른쪽 위 **AI 튜터**를 열고 추천 질문을 눌러 봅니다. **개발자** 패널(`{ }`)에서 마지막 요청(`screen_context`)과 응답 JSON을 볼 수 있습니다.
- 체크포인트까지 이어서 보려면 `http://localhost:3000/checkpoint-test.html?user=내이름`을 엽니다(체크포인트 UI는 아직 메인 페이지에 없음).
- 소스를 지우거나 옮긴 뒤 테스트가 이상하면 `.build/`를 지우고 다시 실행합니다.
- `npm run eval:*`은 체크포인트 평가자용입니다. 학습 모드 작업에는 필요 없습니다.

## 6. 참고: 설비 id

- 기준: `frontend/3d-demo/data_v2.js`(24개).
- 표: [docs/equipment-ids.md](equipment-ids.md).
- 현재 루브릭에는 개념 ↔ 설비 연결이 없습니다. 루브릭 스키마에 개념별 `equipment_ids`를 추가할 예정입니다(수민 담당). "재학습 시 3D 하이라이트"는 그 뒤에 이 값을 읽어 씁니다.
