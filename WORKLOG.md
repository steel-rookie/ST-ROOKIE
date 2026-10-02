# 작업 기록

커밋 본문의 "왜"는 이 파일의 문제/해결에서 가져온다. 새 작업을 하면 위에 추가한다.

## 2026-10-03 공정 GLB 4개 교체와 설비 id 노드 연결

### 문제

- `frontend/3d-demo/models/`의 GLB 4개에 `EQ_<설비 id>` 노드가 없어, v2가 앵커 좌표로만 설비 위치를 잡고 설비를 선택해도 모델에 하이라이트가 붙지 않았다.
- 레퍼런스 이미지로 다시 만든 공정 모델을 넣으면 `scene_v2.js`가 내부 단면을 기본 도형 자리에 그렸다.

### 해결

- 공정 모델 4개를 다시 만들고 공정마다 설비 6개를 `EQ_<설비 id>` 노드로 묶었다(`data_v2.js`의 24개 id와 같음).
- `anchors-v2b.json` 네 공정에서 `anchors`를 빼고, `flow`·`stops`로 소재 경로를, `interiors`로 내부 단면 위치를 지정했다.
- `scene_v2.js`가 노드로 연결된 설비의 내부 단면을 `interiors` 좌표(없으면 노드 경계 상자)에 그리도록 고쳤다.

### 남은 일

- CLAUDE.md의 "현재 GLB에는 `EQ_<설비 id>` 노드가 없고" 문장을 고친다(공용 파일이라 팀과 공유 후).
- GLB 안 오브젝트가 이름순이라 공정 순서로 다시 묶을지 정한다.



## 2026-09-30 팀 폴더 구성에 맞춰 파일 재배치

### 문제

- 팀에서 `backend/`, `frontend/`, `llm/`, `models/` 폴더 구성을 정해 두었지만, 지금까지 작업물은 루트의 `src/`, `web/`, `source/`, `data/`, `prompts/`에 흩어져 있었다.

### 해결

- 서버·세션·데이터·테스트는 `backend/`, LLM 호출 코드와 프롬프트는 `llm/`, 화면은 `frontend/`(`web/`, 3D 데모는 `steel-academy/`), `.glb`는 `models/`로 옮겼다.
- `package.json`, `tsconfig.json`은 루트에 두어 `npm start`, `npm test`를 그대로 루트에서 실행한다. 빌드 결과는 `.build/backend/...`, `.build/llm/...`로 나온다.
- `process.cwd()` 기준 경로를 새 위치(`backend/data`, `llm/prompts`, `frontend/web`)로 바꿨다.

## 2026-09-30 제선 공정 질문형 임시 MVP

### 문제

- Claude API 키 발급이 막혀 기존 교육 에이전트 백엔드(`src/server.ts`, `claude-opus-5-5`)를 실행할 수 없었다.
- 3D 교육 화면과 연결할 프론트엔드가 아직 없어 제선·제강·연주·압연 전체 흐름을 확인할 방법이 없었다.
- `tsx` 대신 `tsc`로 `.build/`에 빌드하자 `import.meta.url` 기준 경로가 `.build/`를 가리켜 `data/`, `prompts/`를 찾지 못했다.

### 해결

- LLM을 Gemini(`gemini-3.5-flash-lite`)로 바꾸고, 키는 서버의 `.env`(`GEMINI_API_KEY`)에만 두도록 했다.
- 프론트가 준비될 때까지 임시로 제선 한 공정만 다루는 질문 API(`POST /api/chat`, `GET /api/status`)와 단일 화면(`web/`)을 만들었다.
- 답변 근거는 포스코 홈페이지·뉴스룸 공개 자료 6건(`data/ironmaking-sources.json`)으로 제한하고, 근거가 없으면 "확인할 수 없음"으로 답하게 했다.
- `src/data.ts`, `src/agent.ts`의 경로를 `process.cwd()` 기준으로 바꿨다.
- 기존 Claude 백엔드는 지우지 않고 `npm run start:legacy`로 따로 실행할 수 있게 남겼다.

### 남은 일

- 3D 프론트가 준비되면 제강·연주·압연 공정과 기존 백엔드 연결 여부를 다시 정한다.

