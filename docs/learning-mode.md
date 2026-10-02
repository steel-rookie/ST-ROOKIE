# 학습 모드 설계

튜터의 학습 모드(자유 질문, 점수 없음)를 Gemini에 연결하는 설계와 결정 사항. 체크포인트 모드는 [checkpoint-api.md](checkpoint-api.md).

체크포인트 작업은 PR #13으로 `dev`에 들어갔다. 학습 모드 구현은 `dev`에서 새 브랜치로 시작한다. 시작 안내는 [onboarding-learning-mode.md](onboarding-learning-mode.md).

## 현재 상태

- 서버 `/api/chat`은 `ironmaking-agent.ts`가 공개 자료 메모(약 25문장)를 통째로 프롬프트에 넣어 Gemini를 1회 호출한다. 응답은 `{answer, status: grounded|unverified, sources, session_id}`, 대화는 서버 메모리에 6턴·2시간 보관한다.
- 화면(최종 페이지 v2)의 학습 모드 입력은 `frontend/3d-demo/learning-chat.js`가 아직 가짜 튜터(`tutor_v2.js`의 `mockTutor`)로 보낸다.
- `ironmaking-agent.ts`는 체크포인트용 `GeminiClient`(responseSchema, 오류 처리, 사용량 제한 훅)를 쓰지 않는 예전 호출 코드다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 3D 화면 조작(`scene_actions`) | 다음 단계로 미룬다. "재학습 시 3D 하이라이트"와 함께 진행한다. |
| 오개념 감지 | 답변과 **같은 응답**에서 감지한다. 학습자가 무언가를 **사실로 단정할 때만** 기록한다. |
| 체크포인트 `conceptOrder` | 루브릭 순서를 유지한다. 학습 모드 오개념은 체크포인트 **튜터의 context로만** 쓴다. |
| 대화 저장 | DB에 저장하고 보관 기간은 두지 않는다. |
| 근거 문서 | `section.md` 작성 전까지 공개 자료 메모로 먼저 연결한다. 검색은 `retrieve()`로 분리한다. |
| 개인 페이지 | `source`가 `learning`인 오개념은 "대화 중 감지됨" 라벨로 구분한다. |

## 흐름

```
POST /api/chat { question, session_id?, screen?: { process_id, equipment_id } }
  → 안전 질문 차단 (mockTutor의 키워드 규칙을 서버로 옮김, LLM 호출 없음)
  → retrieve(section, question, screen): 근거 조각 3~5개
  → 학습자 메모: 이 섹션의 미해결 오개념 요약(학습·체크포인트 모두)
  → Gemini 1회 (GeminiClient, responseSchema, temperature 0.3)
      { answer, status, source_ids, follow_up, detected_misconception: { concept_id, summary } | null }
  → 검증: source_ids가 이번에 검색한 조각인지, concept_id가 루브릭 개념인지
  → detected_misconception이 있으면 misconceptions에 기록(source: learning, 점수 반영 없음)
  → 대화 저장(learning_turns)
응답 { answer, status, sources, follow_up, session_id }
```

- 기존 `/api/chat` 요청·응답 필드는 유지하고 새 필드는 모두 선택값으로 추가한다.
- 사용자 구분(`X-User-Id`, 로그인 후에는 JWT), 접속 비밀번호, 하루 LLM 호출 한도는 체크포인트와 같은 장치를 쓴다.
- 학습 모드는 채점하지 않으므로 오개념을 해결 처리하지 않는다. 해결은 체크포인트에서 맞혔을 때만 일어난다.

### 오개념 감지 기준

- 기록한다: 학습자가 틀린 내용을 사실로 단정한 경우. 예: "코크스가 불순물 없애는 거죠?", "소결은 쇳물 만드는 거잖아요."
- 기록하지 않는다: 열린 질문("코크스가 뭐예요?"), 확인을 구하는 중립 질문, 모델이 추측한 오해.
- `concept_id`는 루브릭 개념 목록 안에서만 고른다(responseSchema enum). 해당 개념이 없으면 기록하지 않는다.

## 근거 문서와 검색

- 기준 문서는 `content/materials/{섹션}/section.md`(CLAUDE.md의 단일 기준). 아직 없다.
- 그 전까지는 `backend/data/ironmaking-sources.json`의 공개 자료 메모를 조각으로 쓴다(지금과 같은 근거).
- `retrieve(section, query, screen)` 인터페이스를 먼저 만든다. 데이터 원천만 바꾸면 `section.md`로 넘어갈 수 있게 한다.
  - `section.md` 조각: 제목(H2/H3) 하나가 조각 하나(300~600자). 제목에 개념·설비 id(`{#coke_reduction}`), 문단 끝에 공개 자료 id(`[src:...]`)를 단다. 출처 링크는 지금처럼 `ironmaking-sources.json`에서 가져온다.
  - 검색: 같은 섹션 안에서 키워드 점수(용어집 동의어 포함), 현재 설비 관련 조각에 가중치. 조각이 100개를 넘으면 임베딩 검색으로 바꾼다.
- `section.md`가 생기면 루브릭의 `quote`도 그 문서 기준으로 다시 만든다.

## 학습자 메모 (체크포인트와 공유)

- 새 테이블 없이 `misconceptions`(`source`: learning | checkpoint)를 중심으로 쓴다.
- `buildLearnerNotes(userId, section)` → `LearnerNotes { conceptOrder, context }`
  - `conceptOrder`: 루브릭 순서 그대로.
  - `context`: 미해결 오개념 요약.
- 학습 모드 → 체크포인트: 체크포인트 시작 시 엔진의 `options.notes`로 넘긴다. **튜터에게만** 주어 부가 설명에서 알려진 오해를 짚게 한다. **평가자에게는 넘기지 않는다**(평가자 입력은 루브릭·질문·답변뿐, 과거 기록으로 채점이 치우치지 않게).
- 체크포인트 → 학습 모드: 체크포인트에서 나온 미해결 오개념을 학습 모드 프롬프트에 넣어, 관련 질문이 오면 먼저 바로잡게 한다. 화면에는 "지난번 헷갈린 개념" 추천 질문으로 보여 준다.

## 저장

`backend/src/db/migrations/004_learning.sql` (`003_users.sql`은 로그인 계정)

```sql
CREATE TABLE learning_turns (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  seq         INTEGER NOT NULL,       -- 세션 안 순서(1부터), UNIQUE (session_id, seq)
  section     TEXT,
  equipment_id TEXT,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  status      TEXT NOT NULL,          -- grounded | unverified | safety_redirect (CHECK)
  source_ids  TEXT NOT NULL,          -- JSON 배열
  created_at  TEXT NOT NULL
);
```

보관 기간은 두지 않는다. 사용자 기록 삭제(`npm run db:reset-user`)에 이 테이블도 포함한다.

- 저장소: `backend/src/learning/repository.ts`(`LearningRepository`). 대화 저장(`saveTurn`), 세션의 최근 대화(`recentTurns`), 세션 주인 확인(`sessionOwner`), 학습 모드 오개념 기록(`recordMisconception`, source=learning), 섹션의 미해결 오개념(`openMisconceptions`, 학습·체크포인트 모두).
- 정렬은 SQLite 전용 `rowid` 대신 `seq`로 한다.

## 개인 페이지 표시

- 오개념 목록에서 `source = learning`은 "대화 중 감지됨", `source = checkpoint`는 "이해도 확인"으로 라벨을 붙인다.
- 상태(미해결/해결됨)는 두 출처 모두 같은 규칙: 체크포인트에서 그 개념을 맞히면 해결됨.

## 파일

| 파일 | 역할 |
|---|---|
| `llm/src/learning-agent.ts` | `ironmaking-agent.ts` 대체. `GeminiClient` 사용, `LearningAgent` 인터페이스(테스트용 가짜 구현) |
| `llm/src/retrieval.ts` | `retrieve()`: 섹션 문서 조각 나누기와 검색 |
| `llm/prompts/learning.md` | 학습 모드 프롬프트 |
| `backend/src/learning/` | 라우트, 안전 규칙, `buildLearnerNotes`(`notes.ts`, 시그니처 고정), 대화 저장소 |
| `frontend/3d-demo/learning-chat.js`의 `ask()` | `mockTutor` 대신 `/api/chat`. `session_id` 유지, 상태 표시와 출처 링크 |

## 다음 단계로 미룬 것

- 학습 모드의 3D 화면 조작(`scene_actions`). 서버가 설비 id 목록을 알아야 한다(지금은 프론트 `data_v2.js`에만 있음, 목록과 v1 차이는 [equipment-ids.md](equipment-ids.md)).
- 재학습 시 3D 하이라이트: 오개념이 있는 개념과 관련된 설비를 3D에서 강조해 다시 보게 한다.
