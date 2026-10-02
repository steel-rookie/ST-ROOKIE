제선 공정 질문형 교육 MVP

포스코 제철소 신입사원을 위한 제선 기초 질문 화면입니다. 퀴즈, 이수 관리, 실제 설비 제어는 포함하지 않습니다.

실행

1. Node.js를 설치합니다.
2. 이 폴더에서 npm ci를 실행합니다.
3. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 Gemini API 키를 준비합니다.
4. 프로젝트 루트의 .env 파일에서 GEMINI_API_KEY= 뒤에 본인의 키를 입력합니다.
   GEMINI_MODEL=gemini-3.5-flash-lite 는 기본값이며 다른 Lite 모델을 쓰려면 바꿀 수 있습니다.
   .env 파일이 없으면 .env.example을 복사해 만드세요. .env는 Git에서 제외됩니다.
5. npm start를 실행하고 http://localhost:3000 을 엽니다.

Windows PowerShell에서 npm 스크립트 실행이 막히면 npm.cmd ci, npm.cmd start를 사용하세요.
서버 시작 시 .env를 읽습니다. 키를 추가하거나 바꿨다면 서버를 재시작하세요. API 키가 비어 있으면 화면에 'Gemini 미연결'로 표시되며 답변을 생성하지 않습니다.

구성

package.json, tsconfig.json은 루트에 두고 npm 명령은 모두 루트에서 실행합니다.

- backend/: 서버, 세션, 공정 데이터, 테스트
  - backend/src/ironmaking-server.ts: 질문 API와 대화 세션. POST /api/chat, GET /api/status를 제공합니다.
  - backend/data/: 제선 공개 자료 목록(ironmaking-sources.json).
  - backend/test/: npm test로 실행하는 테스트.
- llm/: LLM 호출 코드와 프롬프트
  - llm/src/ironmaking-agent.ts: 소량의 공개 자료 메모를 프롬프트에 제공하고 Gemini GenerateContent API를 호출합니다.
  - llm/src/ironmaking-sources.ts: 공식 자료 목록을 읽어 프롬프트용으로 정리합니다. 자료를 늘린 뒤 검색 기능을 붙이기 쉽도록 분리했습니다.
- frontend/: 화면
  - frontend/3d-demo/: 서버 첫 화면(Steel Academy.dc.html). 4개 공정 3D 화면과 튜터 패널. 튜터는 아직 샘플 응답(mockTutor)을 사용합니다.
- models/: 3D 모델 파일(hot-rolling-education.glb).

자료 범위

자료는 포스코 홈페이지와 포스코그룹 뉴스룸의 공개 공식 자료입니다. 사내 자료에 접근하거나 확인한 것으로 표현하지 않습니다. backend/data/ironmaking-sources.json에 각 자료의 제목, 발행일/연도, URL, 관련 주제와 요약을 기록했습니다. 고로와 FINEX 경로를 별도로 설명하고, 특정 제철소의 실제 운전 조건이나 작업 절차는 제공하지 않습니다. 현재 운영 상태와 자료에 없는 내용은 미확인으로 남깁니다.

API 예시

POST /api/chat
요청: {"question":"제선은 어떤 공정인가요?"}
응답: {"answer":"...","status":"grounded","sources":[{"id":"...","title":"...","url":"..."}],"session_id":"..."}

후속 질문에는 앞선 응답의 session_id를 함께 전송합니다. 대화 기록은 서버 메모리에 최대 6턴, 마지막 사용 뒤 2시간까지 보관됩니다. 서버를 재시작하면 사라집니다. 모델이 제시한 출처 ID는 서버가 수집한 자료 목록과 대조한 후 링크를 반환합니다.

검증: npm.cmd run typecheck / npm.cmd test

