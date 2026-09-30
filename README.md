# ST-ROOKIE

## 교육 화면 MVP

[steel-academy.html](steel-academy.html)을 최신 Chrome 또는 Edge에서 열면 3D 열연 교육 데모를 볼 수 있습니다. 수정 가능한 코드는 `source/`에 있으며, 실행 방법과 범위는 [README-ko.txt](README-ko.txt)에 정리되어 있습니다. 화면의 튜터는 준비된 답변 데모이며 아래 에이전트 API와 아직 연결되지 않았습니다.

## 교육 에이전트 백엔드

포스코 제철소 신입사원이 제선·제강·연주·압연 공정을 3D 화면과 함께 배우도록 돕는 교육 에이전트 백엔드입니다. Claude API(`claude-opus-5-5`)와 TypeScript로 만들었습니다.

> `data/`의 교육자료·공정·설비·문항은 모두 **개발용 샘플**입니다. 포스코 공식 자료가 아니므로 실제 교육 전에 승인된 자료로 바꿔야 합니다.

## 실행

```bash
npm install
export ANTHROPIC_API_KEY=...   # 또는 `ant auth login`

npm run chat       # 터미널에서 대화 테스트
npm start          # HTTP 서버 (기본 포트 3000)
npm test           # API 호출 없이 안전장치 테스트
npm run typecheck
```

## 구조

```
prompts/system_prompt.md   시스템 프롬프트 (서버 시작 시 읽음)
data/                      공정·설비·교육자료·문항·3D 동작 목록 (샘플)
src/agent.ts               도구 호출 루프, 화면 맥락 전달, 거절 처리
src/tools.ts               도구 5개 정의와 실행
src/output.ts              응답 JSON 스키마, 인용·화면 동작 검증
src/session.ts             세션과 학습 기록 (메모리 저장)
src/server.ts              HTTP API
src/cli.ts                 터미널 테스트 도구
test/guards.test.ts        서버 측 안전장치 테스트
```

## HTTP API

**`POST /sessions`** → `{ "session_id": "..." }`

```json
{ "learner_id": "emp-001" }
```

**`POST /sessions/:id/messages`** → 에이전트 응답

```json
{
  "message": "이거 뭐 하는 설비야?",
  "screen_context": {
    "process_id": "ironmaking",
    "equipment_id": "blast_furnace",
    "learning_mode": "free_question",
    "learning_step": null,
    "last_scene_action_results": [
      { "type": "highlight", "target_id": "blast_furnace", "status": "succeeded" }
    ]
  }
}
```

`has_3d_model`과 `allowed_scene_actions`는 서버가 `data/scenes.json`을 보고 채웁니다. 프론트엔드가 보낸 값은 쓰지 않습니다.

응답 형식:

```json
{
  "answer": "고로는 철광석을 녹여 쇳물(용선)을 만드는 설비입니다. ...",
  "mode": "free_question",
  "evidence_status": "grounded",
  "citations": [{ "document_id": "SAMPLE-IRON-001", "title": "[샘플] 제선 공정 개요", "page": 2, "version": "sample-0.1" }],
  "scene_actions": [{ "type": "highlight", "target_id": "blast_furnace" }],
  "follow_up_question": "고로에 넣는 코크스는 어떤 두 가지 역할을 할까요?",
  "needs_clarification": false
}
```

프론트엔드는 `scene_actions`를 실행한 뒤, 결과를 다음 요청의 `last_scene_action_results`에 담아 보냅니다.

**`GET /sessions/:id/learning-records`**: 학습 기록 조회 (읽기 전용)

## 원래 프롬프트에서 바꾼 점

| 문제 | 변경 |
|---|---|
| 서버가 보내는 필드(`process_id` 등)의 이름·형식이 정의되지 않음 | `<screen_context>` 형식을 프롬프트에 명시. 사용자 발화가 아니라 system 메시지로 보내서 학습자가 흉내 낼 수 없음 |
| `scene_actions`는 응답 뒤에 실행되는데 "성공 결과를 받기 전에는 말하지 말라"고 해서 모순 | 화면 동작은 응답 필드로만 요청하고(`request_scene_action` 도구 삭제), 답변에는 "보여드릴게요"처럼 요청 수준으로 쓰게 함. 결과는 다음 턴에 전달 |
| 객관식 정답을 모델이 미리 알면 먼저 알려줄 수 있음 | `get_quiz`는 정답 없이 문항만 주고, `grade_quiz_answer`가 서버에서 채점한 뒤 정답·해설을 돌려줌 |
| `record_learning_result`로 모델이 기록을 직접 쓸 수 있음 | 삭제. 채점 도구가 기록을 함께 처리하고, 학습자 메시지에 실제로 있는 답만 채점 |
| 근거가 있는지, 어떤 모드로 답했는지 서버가 알 수 없음 | 응답에 `mode`, `evidence_status` 필드 추가 |
| "Markdown 코드 블록으로 감싸지 마세요" 같은 형식 지시에 의존 | API의 structured outputs로 JSON 스키마를 강제하고 형식 지시는 삭제 |
| 인용을 지어내지 말라는 규칙을 모델에게만 맡김 | 서버가 이번 대화에서 도구가 돌려주지 않은 `document_id`를 걸러내고, 제목·버전은 등록된 값으로 덮어씀 |
| 자료의 적용 범위·검토 상태 확인 방법이 불명확 | 자료마다 `scope`·`review_status`·`applies_to`를 두고 각 값을 어떻게 쓸지 프롬프트에 명시 |
| 비상 상황 응답 형식이 없음 | `mode: "safety_redirect"`로 짧게 비상 절차와 담당자 연락만 안내 |

## 기타 설계

- **거절 대비**: `fallbacks: "default"`(beta `server-side-fallback-2026-07-01`)를 켜 두었습니다. 안전 분류기가 요청을 거절하면 API가 다른 모델로 다시 시도합니다. 끝까지 거절되면 기본 안내 응답을 돌려줍니다.
- **effort**: `medium`으로 설정했습니다. 답변이 얕다면 `src/agent.ts`에서 `high`로 올리세요.
- **대화 기록**: 추가만 하고 고치지 않습니다. 턴 도중 실패하면 그 턴에 추가한 기록만 되돌립니다.
- **세션 저장소**: 지금은 메모리에만 저장하므로 서버를 재시작하면 사라집니다. 운영 환경에서는 DB로 바꿔야 합니다.
- **검색**: 키워드 매칭으로 간단히 구현했습니다. 실제 자료가 많아지면 벡터 검색 등으로 바꾸세요. `searchMaterials`의 입출력 형식만 유지하면 됩니다.
