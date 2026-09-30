# 작업 기록

커밋 본문의 "왜"는 이 파일의 문제/해결에서 가져온다. 새 작업을 하면 위에 추가한다.

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
