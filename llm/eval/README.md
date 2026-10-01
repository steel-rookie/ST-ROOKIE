# 평가자 정확도 평가 세트

`npm run eval:evaluator -- --set smoke|hard`로 실제 Gemini 평가자를 돌려 기대 판정과 비교한다. 비용과 요청 제한 때문에 `npm test`에는 넣지 않는다(파일 형식 검사만 `backend/test/eval-set.test.ts`에서 한다).

| 세트 | 용도 |
|---|---|
| `smoke/` | **회귀 테스트용.** 루브릭 표현을 그대로 따른 쉬운 케이스. 프롬프트·루브릭을 바꾼 뒤 깨진 곳이 없는지 확인한다. 거의 100%가 나와야 정상이고, 평가자 품질의 근거로 쓰지 않는다. |
| `hard/` | **품질 평가용.** 키워드 없는 정답, 오개념 혼합, 오탈자·구어체·영어, 다른 개념 혼동, 은근한 인젝션, 같은 뜻 답변 쌍. 사람이 쓴 답변(`source: "human"`)도 여기에 넣는다. |

## 파일

- 세트 폴더 안의 `{섹션}.jsonl`과 `{섹션}.{아무 이름}.jsonl`(예: `ironmaking.human.jsonl`)을 모두 읽는다.
- 한 줄에 케이스 하나.

| 필드 | 필수 | 설명 |
|---|---|---|
| `concept_id` | ✓ | 루브릭의 개념 id |
| `phase` | ✓ | `initial` 또는 `recheck`(재확인에는 `assisted`가 없다) |
| `question`, `answer` | ✓ | 질문과 학습자 답변 |
| `expected_verdict` | ✓ | 사람이 루브릭으로 정한 기대 판정 |
| `source` | ✓ | `synthetic`(작성한 케이스) 또는 `human`(실제 사람 답변). 결과를 따로 집계한다 |
| `type` | | 케이스 유형(`paraphrase`, `mixed`, `noisy`, `confusion`, `injection`, `pair`) |
| `pair_id` | | 같은 뜻 답변 쌍. 같은 값끼리 판정이 같은지 본다 |
| `question_id` | | 사람 답변 수집 질문 id(`hard/human-collection.md`) |
| `respondent` | | 익명 응답자(`p01`…). 내보내기 스크립트가 붙인다 |
| `case_id` | | 내보낸 사람 답변의 id. 모델 판정 파일과 맞춰 볼 때 쓴다 |
| `note` | | 기대 판정의 근거나 애매한 점 |

## 사람 답변 모으기

1. 팀원 테스트([docs/team-test.md](../../docs/team-test.md))로 각자의 `data/st-rookie.sqlite`를 받는다.
2. `npm run eval:export-human -- --db team-a.sqlite --db team-b.sqlite`
   - 체크포인트의 첫 판정(initial) 답변만 꺼낸다. 재확인 답변은 설명을 들은 뒤라 빼고, 질문은 튜터가 만든 질문 그대로다.
   - 출력: `hard/pending/ironmaking.human.jsonl`(`expected_verdict` 빈칸, `source: "human"`)과 `hard/pending/ironmaking.human.model-verdicts.jsonl`(당시 모델 판정, `case_id`로 연결). `pending/`은 Git에서 제외한다.
   - 사용자 id는 DB·사용자별로 `p01`, `p02`…로 바꾼다. 이미 파일이 있으면 덮어쓰지 않는다(`--force`로 덮어쓰기).
3. 모델 판정 파일을 보지 않고 `expected_verdict`를 채운다(블라인드 판정).
4. 채운 파일을 `hard/ironmaking.human.jsonl`로 옮긴 뒤 모델 판정 파일과 비교하거나 `--set hard`로 다시 채점한다.

## 출력

- 일치율: 전체, 단계별, source별, 유형별
- 혼동 표: source별
- 평가자 형식 재시도: 케이스별 횟수와 전체 비율
- 같은 뜻 쌍 일치율과 판정이 갈린 쌍
- 틀린 케이스 목록
