# 메인 페이지에 체크포인트 붙이기

메인 3D 페이지(`frontend/3d-demo/Steel Academy v2.dc.html`)의 튜터 패널에 학습 모드와 체크포인트(이해도 확인) 모드를 함께 둔다. 이 문서는 정해진 내용, 모듈 구조, 템플릿에 쓸 값(`vals()` 키), PR 순서를 적는다. 체크포인트 API는 [checkpoint-api.md](checkpoint-api.md)를 본다.

## 결정 사항

1. **체크포인트 진행 중에는 학습 입력을 막는다.** 3D 화면은 계속 볼 수 있다. 학습 탭에는 "이해도 확인을 마치면 다시 질문할 수 있어요"를 보여 준다(`cpLearningLocked`, `cpLearningLockedText`).
2. **잠그는 것은 체크포인트뿐이다.** 공정 탭에는 '미통과 / 단련 완료' 배지만 보여 준다(`cpSections`). 탭까지 잠그려면 `checkpoint-chat.js`의 `LOCK_PROCESS_TABS`를 `true`로 바꾼다. 기본값은 `false`다.
3. **메인 페이지는 로그인 필수다.** `?user=이름` 방식은 ④에서 지운다. `TEST_PASSCODE`(접속 비밀번호)도 ④에서 지운다(아래 '접속 비밀번호 정리').
4. **viiin2님이 v2에 체크포인트를 붙이는 것을 허락했다.** v2 수정 PR(③)의 리뷰어는 viiin2님이다.

## 모듈 구조

```
Steel Academy v2.dc.html (페이지, viiin2)
  state.tutorMode: 'learning' | 'checkpoint'   ← ③에서 추가
  튜터 패널 상단 탭 [학습 | 이해도 확인]
  ...this.chat.vals(D)        학습 모드 값
  ...this.checkpoint.vals()   체크포인트 값(cp로 시작)
        │                         │
learning-chat.js (ssoyoum)      checkpoint-chat.js (수민)
  ask, runActions, vals           refresh, refreshAll, start, send, ready, retry, close, vals
        └────────────┬────────────┘
              api-client.js (공용)          tutor-text.js (화면 문구)
              토큰·접속 비밀번호 헤더,         탭 이름, 버튼, 배지, 안내 문장
              401·429·502·503 안내
```

| 파일 | 맡는 일 | 맡지 않는 일 |
|---|---|---|
| 페이지 | 모드 탭, 템플릿, 3D, 공정 이동. 공정을 옮기면 `checkpoint.refresh()`를 부른다 | API 호출, 체크포인트 진행 규칙 |
| `learning-chat.js` | 학습 모드 질문·답변, 화면 조작 | 체크포인트. 진행 중 입력 막기는 `cpLearningLocked`를 보고 한다(②·③) |
| `checkpoint-chat.js` | 진입 상태, 시작, 답변, 재채점, 새로고침 복원, 결과 값 | DOM. `document`·`querySelector`·`innerHTML`을 쓰지 않는다 |
| `api-client.js` | 요청 헤더(로그인 토큰, 접속 비밀번호), 오류 문장 통일. 로그인 만료(`TOKEN_INVALID`)면 저장된 토큰을 지운다 | `X-User-Id`. 메인 페이지는 로그인 필수라 보내지 않는다 |
| `tutor-text.js` | 화면 문구 상수(`TEXT`) | 로직 |

- 화면 문구는 `tutor-text.js` 한 곳에만 둔다. 팀이 이름을 바꾸면(예: '단련 완료' → '담금질 완료') 이 파일만 고친다.
- 섹션은 페이지의 현재 공정(`state.processId`)이다. 전체 보기(`site`)에서는 시작할 수 없다. 시작한 시도는 끝날 때까지 공정을 옮겨도 패널에 그대로 보인다.
- 로그인 토큰이 없으면 API를 부르지 않고 로그인 안내를 보여 준다(`cpNeedsLogin`).
- 공정 이름은 `data_v2.js`의 `findProcess(id).name`을 쓴다(페이지의 `this.data`).

## 페이지에 붙이는 방법 (③)

```js
// 체크포인트 상태 키(cp로 시작)는 적지 않아도 된다. 없으면 checkpoint-chat.js가 초기값(CHECKPOINT_STATE)으로 본다.
state = { ...기존값, tutorMode: 'learning' };

async componentDidMount() {
  const [d, lc, cc] = await Promise.all([import('./data_v2.js'), import('./learning-chat.js'), import('./checkpoint-chat.js')]);
  this.data = d;
  this.chat = await lc.createLearningChat(this);
  this.checkpoint = cc.createCheckpointChat(this);
  this.checkpoint.refreshAll(); // 공정 탭 배지 + 진행 중인 시도 복원
}

goProcess(id) { /* 기존 코드 */ this.checkpoint.refresh(id); }

// 선택: 체크포인트 메시지 영역을 아래로 내리는 함수. 있으면 checkpoint-chat.js가 메시지가 늘 때 부른다.
scrollCheckpoint() { ... }

renderVals() { return { ...기존값, ...this.chat.vals(D), ...this.checkpoint.vals() }; }
```

v2의 `state`는 `componentDidMount`에서 모듈을 불러오기 전에 만들어지므로 `CHECKPOINT_STATE`를 펼쳐 넣을 수 없다. 그래서 `checkpoint-chat.js`가 없는 키를 초기값으로 보고, 키마다 처음 바꿀 때 state에 생긴다.

## 상태 키 (페이지 state)

| 키 | 값 |
|---|---|
| `cpView` | 서버 `CheckpointView`(진행 중이거나 막 끝난 시도). `null`이면 진입 화면 |
| `cpMessages` | `{ role: 'tutor' \| 'user', type, text }[]` |
| `cpInput` | 입력창 값 |
| `cpPending` | 요청 중 |
| `cpNotice` | 오류·안내 문장 |
| `cpProgress` | 섹션 → `SectionProgressView` 또는 `{ unavailable: true, status }`(404면 루브릭 없음) |

## 메서드

| 메서드 | 언제 |
|---|---|
| `refreshAll()` | 페이지를 열 때. 네 섹션의 진입 상태를 읽고, 진행 중인 시도가 있으면 연다(새로고침 복원) |
| `refresh(section = processId)` | 공정을 옮길 때. 그 섹션만 다시 읽는다 |
| `start()` | 현재 공정의 이해도 확인 시작. 진행 중인 시도가 있으면 서버가 이어서 준다 |
| `send(text)` | 답변 보내기. 준비·답변·재확인 단계에서만 보낸다. 실패하면 입력이 그대로 남는다 |
| `ready()` | '준비됐어요' 버튼 |
| `retry()` | 채점 오류(`state = error`) 뒤 같은 답변 다시 채점 |
| `close()` | 결과 화면 닫기. 끝난 시도만 닫을 수 있다 |
| `isActive()` | 진행 중인 시도가 있는지(= 학습 입력을 막을지) |
| `tabLocked(section)` | `LOCK_PROCESS_TABS`가 켜져 있고 열리지 않은 공정인지 |

## `vals()` 키

모두 `cp`로 시작해서 학습 모드 값(`messages`, `input`, `send` 등)과 겹치지 않는다. `on`으로 시작하는 키는 클릭·입력 핸들러다.

### 탭과 공정 배지

| 키 | 형식 | 설명 |
|---|---|---|
| `cpTabLearningLabel` | 문자열 | 모드 탭 이름 '학습' |
| `cpTabCheckpointLabel` | 문자열 | 모드 탭 이름 '이해도 확인' |
| `cpSections` | 배열 | 공정 탭 배지. 항목: `id`, `name`, `badge`('단련 완료' · '미통과' · `null`), `passed`, `tabLocked`. 루브릭이 없거나(404) 아직 못 읽은 공정은 `badge: null`(배지 없음) |

### 화면 구분

패널 안에서 셋 중 하나만 `true`다.

| 키 | 설명 |
|---|---|
| `cpShowEntry` | 진입 화면(시작 전) |
| `cpShowRunning` | 진행 화면(준비·질문·재확인·채점 오류) |
| `cpShowResult` | 결과 화면 |

### 진입 화면

| 키 | 형식 | 설명 |
|---|---|---|
| `cpNeedsLogin` | 불리언 | 로그인 토큰이 없음. 로그인 버튼을 보여 준다 |
| `cpLoginLabel`, `cpLoginUrl` | 문자열 | '로그인', `/login` |
| `cpEntrySectionName` | 문자열 | 현재 공정 이름. 전체 보기면 빈 문자열 |
| `cpEntryStatus` | 문자열 | 진입 상태 문장: 공정 선택 안내 · 로그인 안내 · 확인 중 · 준비 중 · 연결 안 됨 · 잠김 · 통과 N% · 진행 중 · 재도전 · 시작 전 |
| `cpEntryPassed` | 불리언 | 통과한 공정(초록 표시용) |
| `cpCanStart` | 불리언 | 시작 버튼을 누를 수 있음 |
| `cpStartLabel` | 문자열 | '시작' · '이어서 하기' · '재도전' |
| `onCpStart` | 함수 | 시작 |

### 진행 화면

| 키 | 형식 | 설명 |
|---|---|---|
| `cpTitle` | 문자열 | '이해도 확인 · 제선', 재도전이면 '(재도전)'을 붙인다 |
| `cpSection` | 문자열 | 시도의 섹션 id(현재 공정과 다를 수 있다) |
| `cpState` | 문자열 | 서버 상태: `awaiting_ready` · `awaiting_answer` · `awaiting_recheck` · `error` · `completed` |
| `cpStageLabel` | 문자열 | 단계 표시: '준비' · '재도전 준비' · '개념 2/3' · **'개념 2/3 · 재확인'** · '개념 2/3 · 채점 오류' · '완료' |
| `cpIsRecheck` | 불리언 | 재확인 단계. 재확인 질문이 새 개념처럼 보이지 않게 강조할 때 쓴다 |
| `cpConceptName` | 문자열 | 지금 개념 이름. 준비 단계면 '준비되면 시작할게요'(재도전이면 '지난번에 어려웠던 개념만 다시 물어볼게요') |
| `cpConceptIndex`, `cpConceptTotal` | 숫자 | 개념 순번과 전체 수 |
| `cpDots` | 배열 | 진행 점. 항목: `conceptId`, `index`(1부터), `status`(`done` · `current` · `pending`), `isDone`, `isCurrent` |
| `cpMessages` | 배열 | 메시지. 항목: `key`, `text`, `type`, `isUser`, `isTutor`, `label`(튜터 메시지 머리말, 예: '질문' · '다른 각도로 다시 물어볼게요' · '설명'), `isRecheck`, `isError` |
| `cpPending` | 불리언 | 요청 중(로딩 표시) |
| `cpShowReadyButton`, `cpReadyLabel`, `onCpReady` | | '준비됐어요' 버튼 |
| `cpShowRetryButton`, `cpRetryLabel`, `onCpRetry` | | '다시 채점하기' 버튼(채점 오류일 때) |
| `cpShowComposer` | 불리언 | 입력창을 보여 줄지 |
| `cpInput`, `onCpInput` | | 입력창 값과 `onInput` 핸들러(`e.target.value`) |
| `cpInputDisabled` | 불리언 | 요청 중이거나 채점 오류면 입력 막기 |
| `cpPlaceholder` | 문자열 | 단계별 안내 |
| `cpSendLabel`, `onCpSend` | | 보내기. `onCpSend`는 form `onSubmit`에 쓰고 `preventDefault`를 부른다 |

### 결과 화면

| 키 | 형식 | 설명 |
|---|---|---|
| `cpResult` | 객체 \| `null` | `percent`(이해도 %), `thresholdPercent`(80), `thresholdLabel`('기준 80%'), `passed`, `tone`(`ok` · `warn`), `color`, `passLabel`(통과 · 다음 공정 열림 / 준비 중 / 모든 공정 마침, 또는 미달 안내), `bars` |
| `cpResult.bars` | 배열 | 개념별 가로 막대. 항목: `conceptId`, `name`, `verdict`(`correct` · `partial` · `wrong`), `verdictLabel`('맞음' · '부분' · '틀림'), `score`, `label`('맞음 · 1점'), `widthPercent`(0점도 보이게 최소 3), `tone`(`ok` · `warn` · `danger`), `color` |
| `cpCloseLabel`, `onCpClose` | | 결과 닫기 |

`color`는 CSS 값이다. v2에 `--ok`·`--warn` 변수가 없어서 `var(--ok, #2f9e44)`처럼 기본색을 함께 준다. 페이지에 변수를 만들면 그 값이 쓰인다.

### 안내와 학습 잠금

| 키 | 형식 | 설명 |
|---|---|---|
| `cpNotice`, `cpHasNotice` | 문자열, 불리언 | 오류·안내 문장(로그인 만료, 사용량 초과, 서버 오류, 409 등) |
| `cpLearningLocked` | 불리언 | 체크포인트 진행 중. 학습 입력과 추천 질문을 막는다 |
| `cpLearningLockedText` | 문자열 | 학습 탭 안내 '이해도 확인을 마치면 다시 질문할 수 있어요.' |

## 오류 문장 (api-client.js)

| 응답 | 문장(`TEXT.errors`) |
|---|---|
| 연결 실패 | `network` |
| 401 `TOKEN_INVALID` | `tokenInvalid`. 저장된 토큰을 지운다 |
| 401 `PASSCODE_REQUIRED` | `passcode` |
| 그 밖의 401 | `loginRequired` |
| 429 | `usageLimit` |
| 502 · 503 | `server` |
| 그 밖의 오류 | 서버가 준 `error` 문장(예: 409 이미 통과한 섹션), 없으면 `unknown` |

## 테스트

`backend/test/checkpoint-chat.test.ts`. 가짜 fetch·저장소·페이지 컴포넌트로 브라우저 없이 `vals()` 값만 확인한다. `npm test`에 포함된다.

- 시작 → 답변 → 재확인 → 결과(단계 표시, 학습 잠금, 결과 막대, 공정 배지)
- 새로고침 복원
- 채점 오류 → 다시 채점하기
- 401 로그인 만료, 429 사용량 초과
- 전체 보기(site)와 로그인 전에는 시작하지 않음
- 진입 상태(404 준비 중, 잠김, 재도전, 409)
- api-client 헤더와 오류 문장

## PR 순서

각각 따로 내고, 모두 최신 `dev`에서 브랜치를 만든다.

| | 내용 | 조건 |
|---|---|---|
| ① | `checkpoint-chat.js`, `api-client.js`, `tutor-text.js`, 테스트, 이 문서 | 지금 |
| ② | `learning-chat.js`가 `api-client.js`를 쓰게 수정 | ssoyoum님 확인 후 |
| ③ | v2에 모드 탭 + 체크포인트 템플릿 연결 + 머리글 '가짜 튜터(mockTutor)' 문구 수정. 리뷰어 viiin2님 | ① 병합 후 |
| ④ | `?user=` 방식 제거(`request-user.ts`의 헤더 경로 등), 로그인 요청 외 모든 `/api` 로그인 필수, `TEST_PASSCODE` 제거, 로그인 시도 지연 또는 횟수 제한, `checkpoint-test.html` 정리, CLAUDE.md 갱신 | ③ 병합 후 |

## 접속 비밀번호 정리 (④에서 함)

`TEST_PASSCODE`를 켜면 모든 `/api` 요청(로그인 포함)에 비밀번호가 필요한데, 비밀번호를 입력받는 곳은 `checkpoint-test.html`뿐이다. 입력칸을 새로 만들지 않고 ④에서 접속 비밀번호를 없애기로 했다. 그 대신 로그인으로 막는다.

- 로그인 요청(`/api/auth/*`의 로그인·회원가입·찾기) 외의 모든 `/api`는 로그인 필수
- `TEST_PASSCODE`와 `X-Test-Passcode` 검사(`backend/src/test-access.ts`) 제거
- 로그인 시도에 지연 또는 횟수 제한(터널 주소가 공개되므로 무차별 대입을 느리게 한다)
- `api-client.js`의 접속 비밀번호 헤더와 `setPasscode()` 제거

①~③ 동안에는 지금처럼 `TEST_PASSCODE`를 쓸 수 있고, `api-client.js`는 저장된 비밀번호가 있으면 헤더로 보낸다.
