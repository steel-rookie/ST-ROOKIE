# 메인 페이지에 체크포인트 붙이기

메인 3D 페이지(`frontend/3d-demo/Steel Academy v2.dc.html`)의 튜터 패널에 학습 모드와 체크포인트(이해도 확인) 모드를 함께 둔다. 이 문서는 정해진 내용, 모듈 구조, 템플릿에 쓸 값(`vals()` 키), PR 순서를 적는다. 체크포인트 API는 [checkpoint-api.md](checkpoint-api.md)를 본다.

## 결정 사항

1. **답하는 중(준비·답변·재확인·채점 오류)에는 학습 입력을 막는다.** 3D 화면은 계속 볼 수 있다. 학습 질문을 하려 하면 "풀던 이해도 확인이 있어요. 잠깐 멈추고 질문할까요? [멈추고 질문하기]"를 보여 주고, 누르면 멈춘 뒤 그 질문을 보낸다(`cpShowPauseOffer`). '나중에 이어 풀기'로 멈춘 시도(`paused`)는 학습 입력을 막지 않는다. 규칙은 [checkpoint-api.md](checkpoint-api.md) '나중에 이어 풀기'.
2. **잠그는 것은 체크포인트뿐이다.** 공정 탭에는 '미통과 / 단련 완료' 배지만 보여 준다(`cpSections`). 탭까지 잠그려면 `checkpoint-chat.js`의 `LOCK_PROCESS_TABS`를 `true`로 바꾼다. 기본값은 `false`다.
3. **메인 페이지는 로그인 필수다.** `?user=이름` 방식은 ④에서 지운다. `TEST_PASSCODE`(접속 비밀번호)도 ④에서 지운다(아래 '접속 비밀번호 정리').
4. **viiin2님이 v2에 체크포인트를 붙이는 것을 허락했다.** v2 수정 PR(③)의 리뷰어는 viiin2님이다.

## 모듈 구조

```
Steel Academy v2.dc.html (페이지, viiin2)
  state.tutorMode: 'learning' | 'checkpoint'   (없으면 learning. 바꾸는 일은 checkpoint-chat.js)
  튜터 패널 상단 탭 [학습 | 이해도 확인]
  ...this.checkpoint.lockLearning(this.chat.vals(D))   학습 모드 값(진행 중이면 잠금)
  ...this.checkpoint.vals()                            체크포인트 값(cp로 시작)
        │                         │
learning-chat.js (ssoyoum)      checkpoint-chat.js (수민)
  ask, runActions, vals           refresh, refreshAll, start, send, ready, retry, close, vals,
                                  setMode, runLearning, lockLearning, sectionBadge
        └────────────┬────────────┘
              api-client.js (공용)          tutor-text.js (화면 문구)
              토큰·접속 비밀번호 헤더,         탭 이름, 버튼, 배지, 안내 문장
              401·429·502·503 안내
```

| 파일 | 맡는 일 | 맡지 않는 일 |
|---|---|---|
| 페이지 | 템플릿, 3D, 공정 이동. 공정을 옮기면 `checkpoint.refresh()`를 부른다 | API 호출, 체크포인트 진행 규칙, 탭·잠금 판단 |
| `learning-chat.js` | 학습 모드 질문·답변, 화면 조작 | 체크포인트. 진행 중 잠금은 `checkpoint-chat.js`가 학습 값에 씌운다(`learning-chat.js`는 고치지 않음) |
| `checkpoint-chat.js` | 진입 상태, 시작, 답변, 재채점, 새로고침 복원, 결과 값, 모드 탭, 학습 잠금, 공정 배지 | DOM. `document`·`querySelector`·`innerHTML`을 쓰지 않는다 |
| `api-client.js` | 요청 헤더(로그인 토큰, 접속 비밀번호), 오류 문장 통일. 로그인 만료(`TOKEN_INVALID`)면 저장된 토큰을 지운다 | `X-User-Id`. 메인 페이지는 로그인 필수라 보내지 않는다 |
| `tutor-text.js` | 화면 문구 상수(`TEXT`) | 로직 |

- 화면 문구는 `tutor-text.js` 한 곳에만 둔다. 팀이 이름을 바꾸면(예: '단련 완료' → '담금질 완료') 이 파일만 고친다.
- 섹션은 페이지의 현재 공정(`state.processId`)이다. 전체 보기(`site`)에서는 시작할 수 없다. 시작한 시도는 끝날 때까지 공정을 옮겨도 패널에 그대로 보인다.
- 로그인 토큰이 없으면 API를 부르지 않고 로그인 안내를 보여 준다(`cpNeedsLogin`).
- 공정 이름은 `data_v2.js`의 `findProcess(id).name`을 쓴다(페이지의 `this.data`).

## 페이지에 붙인 방법 (③)

#50(v2 화면 개편) 위에 얹었다. #50의 디자인은 그대로 두고 체크포인트 부분만 더했다. v2 스크립트에서 바꾼 곳은 아래뿐이고, `state`에는 아무 키도 더하지 않았다.

```js
async componentDidMount() {
  const [d, lc, cc] = await Promise.all([import('./data_v2.js'), import('./learning-chat.js'), import('./checkpoint-chat.js')]);
  this.data = d; this.chat = await lc.createLearningChat(this);
  this.checkpoint = cc.createCheckpointChat(this); this.checkpoint.refreshAll(); // 공정 탭 배지 + 진행 중인 시도 복원
}
goProcess(id) { if (this.checkpoint?.tabLocked(id)) return; this.checkpoint?.refresh(id); /* 기존 코드 */ }
ask(text) { return this.checkpoint.runLearning(() => this.chat.ask(text)); } // 진행 중이면 막고, 아니면 학습 탭으로
// renderVals()
steps: D.PROCESSES....map(x => ({ ...x, ...this.checkpoint.sectionBadge(x.id), ... })),
const chatV = this.checkpoint.lockLearning(this.chat.vals(D));   // 학습 값 잠금
send: e => { e.preventDefault(); if (!aiDown) this.ask(S.input); },  // #50의 send도 ask(runLearning)를 거치게
...base, ...chatV, messages, ...this.checkpoint.vals(), ...
```

- 체크포인트 메시지 영역은 학습 메시지 영역과 같은 `chatRef`를 쓴다(두 영역은 동시에 보이지 않는다). 그래서 `scrollCheckpoint()`를 따로 두지 않고 `checkpoint-chat.js`가 `scrollChat()`을 부른다.
- v2의 `state`는 `componentDidMount`에서 모듈을 불러오기 전에 만들어지므로 `CHECKPOINT_STATE`를 펼쳐 넣을 수 없다. 그래서 `checkpoint-chat.js`가 없는 키(`tutorMode`, `cp...`)를 초기값으로 보고, 키마다 처음 바꿀 때 state에 생긴다.
- 템플릿(#50의 오른쪽 패널 `panel.tutor` 안): 머리글('학습 모드 · 제선'), 모드 탭, 학습 영역을 `cpIsLearningTab`으로 감쌈, 학습 잠금 안내와 입력·전송 `disabled`, 잠금 중 '추천 질문' 제목 숨김, 이해도 확인 탭(단계 표시는 메시지 위에 고정, 메시지, 결과 차트, 입력). 색은 #50의 `--chrome`·`--chrome3`·`--line2`를 쓴다.
- 공정 배지는 왼쪽 공정 목록의 펼친 메뉴에만 있다. 아이콘만 보이는 접힌 메뉴(`L.rail`)에는 넣지 않았다.

## 상태 키 (페이지 state)

| 키 | 값 |
|---|---|
| `cpView` | 서버 `CheckpointView`(진행 중이거나 막 끝난 시도). `null`이면 진입 화면 |
| `cpMessages` | `{ role: 'tutor' \| 'user', type, text }[]` |
| `cpInput` | 입력창 값 |
| `cpPending` | 요청 중 |
| `cpNotice` | 오류·안내 문장 |
| `cpProgress` | 섹션 → `SectionProgressView` 또는 `{ unavailable: true, status }`(404면 루브릭 없음) |
| `cpConfirmPause` | [나중에 이어 풀기] 확인창이 열려 있음 |
| `cpPauseOffer` | 답하는 중 학습 질문을 하려 해서 [멈추고 질문하기] 안내를 띄움 |
| `cpOverlayOpen` | 이해도 확인 오버레이 표시. 로그인·새로고침 복원 때는 열지 않는다 |
| `cpTurn` | 이번 응답의 튜터 발화(`cpMessages`와 같은 형식). 복원 때는 마지막 사용자 메시지 뒤 발화 |
| `cpBubbleIndex` | 말풍선이 보여 주는 `cpTurn` 번호 |
| `cpShowHistory` | 오버레이 대화 기록 펼침 |

## 메서드

| 메서드 | 언제 |
|---|---|
| `refreshAll()` | 페이지를 열 때. 네 섹션의 진입 상태를 읽고, 끝나지 않은 시도가 있으면 불러 둔다(새로고침 복원, 탭은 바꾸지 않음) |
| `refresh(section = processId)` | 공정을 옮길 때. 그 섹션만 다시 읽는다 |
| `start(section = processId)` | 이해도 확인 시작. 오버레이를 요청 전에 열고 실패하면 닫는다. 다른 공정이면 페이지 `goProcess(section)`(있으면)를 부른다. 진행 중인 시도가 있으면 서버가 이어서 준다 |
| `openSection(section)` | 공정 목록 섹션 버튼. 그 섹션의 풀던 시도가 열려 있으면 `resume()`, 끝난 시도(결과)가 열려 있으면 닫고 `start(section)`. 시작해서 멈춘 시도를 받으면 `resume()` |
| `exit()` | 오버레이 [나가기]. 답하는 중이면 멈춤 확인창(`askPause`), 끝난 시도는 `close()`, 그 밖에는 오버레이만 닫는다 |
| `nextBubble()` · `toggleHistory()` | 말풍선 [다음] · 대화 기록 펼치기·접기 |
| `send(text)` | 답변 보내기. 준비·답변·재확인 단계에서만 보낸다. 실패하면 입력이 그대로 남는다 |
| `ready()` | '준비됐어요' 버튼 |
| `retry()` | 채점 오류(`state = error`) 뒤 같은 답변 다시 채점 |
| `close()` | 결과 화면 닫기(오버레이도 닫는다). 끝난 시도만 닫을 수 있다 |
| `isActive()` | 답하는 중인 시도가 있는지(= 학습 입력을 막을지). `paused`·`completed`는 `false` |
| `askPause()` · `cancelPause()` | [나중에 이어 풀기] 확인창 열기·닫기 |
| `pause()` | `POST /pause`. 답하는 중에만. 멈추면 오버레이를 닫는다 |
| `resume()` | [이어 풀기]. 오버레이를 열고 이해도 확인 탭으로 옮긴 뒤, `paused`면 `POST /resume`(멈추지 않은 시도는 요청 없이 열기만) |
| `pauseForLearning()` | [멈추고 질문하기]. 멈춘 뒤(오버레이가 닫힌다) 학습 탭으로 옮기고, 페이지 `openTutor()`(있으면)로 튜터 패널을 연 다음 막혀 있던 학습 질문을 보낸다. 멈추기에 실패하면 보내지 않는다 |
| `tabLocked(section)` | `LOCK_PROCESS_TABS`가 켜져 있고 열리지 않은 공정인지 |
| `setMode(mode)` | 모드 탭 바꾸기(`learning` · `checkpoint`). 이해도 확인 탭을 열면 현재 공정의 진입 상태를 다시 읽는다 |
| `runLearning(send)` | 페이지 `ask()`를 감싼다. 학습 탭으로 바꾼 뒤 `send()`. 답하는 중이면 보내지 않고 질문을 들고 있다가 [멈추고 질문하기]를 띄운다 |
| `lockLearning(learningVals)` | 학습 모드 값에 잠금을 씌운다. 답하는 중이면 `chips: []`, `send`는 [멈추고 질문하기]만 띄움, 메시지의 '생각해 보기'(`hasFollowUp`) 숨김 |
| `sectionBadge(section)` | 공정 탭 항목에 펼칠 값: 배지(`cpHasBadge`, `cpBadge`, `cpBadgeColor`, `cpTabLocked`)와 섹션 버튼(`cpSection*`, 아래 '공정 목록 섹션 버튼') |
| `motionFor(type, { unlocked })` (모듈 함수) | 튜터 발화 type → 캐릭터 동작 이름표(아래 '오버레이') |

옵션 `createCheckpointChat(c, { tabs })`: `tabs: false`(v3)면 튜터 패널 모드 탭을 쓰지 않는다. 모드는 늘 학습이고 `resume()`·`setMode()`가 `tutorMode`를 바꾸지 않는다. 탭 값(`cpTabs` 등)은 그대로 내고 `cpShowTabs`만 `false`다(탭 값과 `tutorMode` 코드는 PR 4에서 정리). v2는 기본값(`true`).

페이지 훅(선택): `goProcess(id)`(다른 공정의 섹션 버튼을 누르면 그 공정으로 옮김), `openTutor()`(멈추고 질문하기에서 튜터 패널 열기). 없으면 부르지 않는다.

로그인·새로고침으로 끝나지 않은 시도를 다시 열어도 모드는 바꾸지 않는다. 학습 탭에 "풀던 이해도 확인이 있어요 [이어 풀기]"(`cpShowResumeBanner`)가 뜬다.

## `vals()` 키

모두 `cp`로 시작해서 학습 모드 값(`messages`, `input`, `send` 등)과 겹치지 않는다. `on`으로 시작하는 키는 클릭·입력 핸들러다.

### 탭과 공정 배지

| 키 | 형식 | 설명 |
|---|---|---|
| `cpTabLearningLabel` | 문자열 | 모드 탭 이름 '학습' |
| `cpTabCheckpointLabel` | 문자열 | 모드 탭 이름 '이해도 확인' |
| `cpTabs` | 배열 | 모드 탭. 항목: `id`, `label`, `active`, `onClick`, `bg`, `color`, `weight` |
| `cpIsLearningTab`, `cpIsCheckpointTab` | 불리언 | 지금 모드 |
| `cpShowTabs` | 불리언 | 모드 탭 줄을 보일지(`tabs` 옵션). v3는 `false` |
| `cpHeaderMode` | 문자열 | 머리글 모드 이름 '학습 모드' · '이해도 확인 모드'(`TEXT.header`) |
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
| `cpStartLabel` | 문자열 | '시작' · '이어서 하기' · '재도전'. 누를 수 없을 때도 '시작' |
| `cpShowStartButton` | 불리언 | 시작 버튼을 보여 줄지. 통과한 공정과 로그인 전에는 숨긴다. 전체 보기(site)에서는 보이되 비활성 |
| `cpStartOpacity` | 문자열 | 시작 버튼 투명도(누를 수 없으면 `.45`) |
| `onCpStart` | 함수 | 시작 |

### 진행 화면

| 키 | 형식 | 설명 |
|---|---|---|
| `cpTitle` | 문자열 | '이해도 확인 · 제선', 재도전이면 '(재도전)'을 붙인다 |
| `cpSection` | 문자열 | 시도의 섹션 id(현재 공정과 다를 수 있다) |
| `cpState` | 문자열 | 서버 상태: `awaiting_ready` · `awaiting_answer` · `awaiting_recheck` · `error` · `completed` |
| `cpStageLabel` | 문자열 | 단계 표시: '준비' · '재도전 준비' · '개념 2/3' · **'개념 2/3 · 재확인'** · '개념 2/3 · 채점 오류' · '완료' |
| `cpIsRecheck` | 불리언 | 재확인 단계. 재확인 질문이 새 개념처럼 보이지 않게 강조할 때 쓴다 |
| `cpStageColor` | 문자열 | 단계 표시 색: 재확인 주황, 채점 오류 빨강, 완료 초록, 그 밖에 `var(--accent)` |
| `cpConceptName` | 문자열 | 지금 개념 이름. 준비 단계면 '준비되면 시작할게요'(재도전이면 '지난번에 어려웠던 개념만 다시 물어볼게요') |
| `cpConceptIndex`, `cpConceptTotal` | 숫자 | 개념 순번과 전체 수 |
| `cpDots` | 배열 | 진행 점. 항목: `conceptId`, `index`(1부터), `status`(`done` · `current` · `pending`), `isDone`, `isCurrent`, `color` |
| `cpMessages` | 배열 | 메시지. 항목: `key`, `text`, `type`, `isUser`, `isTutor`, `label`(튜터 메시지 머리말, 예: '질문' · '다른 각도로 다시 물어볼게요' · '설명'), `isRecheck`, `isError`, `color`(머리말·왼쪽 선 색: 재확인 주황, 채점 오류 빨강) |
| `cpPending` | 불리언 | 요청 중(로딩 표시) |
| `cpShowReadyButton`, `cpReadyLabel`, `onCpReady` | | '준비됐어요' 버튼 |
| `cpShowRetryButton`, `cpRetryLabel`, `onCpRetry` | | '다시 채점하기' 버튼(채점 오류일 때) |
| `cpShowComposer` | 불리언 | 입력창을 보여 줄지 |
| `cpInput`, `onCpInput` | | 입력창 값과 `onInput` 핸들러(`e.target.value`) |
| `cpInputDisabled` | 불리언 | 요청 중이거나 채점 오류면 입력 막기 |
| `cpInputOpacity` | 문자열 | 입력 줄 투명도(막혔으면 `.5`) |
| `cpPlaceholder` | 문자열 | 단계별 안내 |
| `cpSendLabel`, `onCpSend` | | 보내기. `onCpSend`는 form `onSubmit`에 쓰고 `preventDefault`를 부른다 |

### 결과 화면

| 키 | 형식 | 설명 |
|---|---|---|
| `cpResult` | 객체 \| `null` | `understandingLabel`('이해도'), `percent`(이해도 %), `thresholdPercent`(80), `thresholdLabel`('기준 80%'), `passed`, `tone`(`ok` · `warn`), `color`, `passLabel`(통과 · 다음 공정 열림 / 준비 중 / 모든 공정 마침, 또는 미달 안내), `bars` |
| `cpResult.bars` | 배열 | 개념별 가로 막대. 항목: `conceptId`, `name`, `verdict`(`correct` · `partial` · `wrong`), `verdictLabel`('맞음' · '부분' · '틀림'), `score`, `label`('맞음 · 1점'), `widthPercent`(0점도 보이게 최소 3), `tone`(`ok` · `warn` · `danger`), `color` |
| `cpCloseLabel`, `onCpClose` | | 결과 닫기 |

`color`는 CSS 값이다. v2에 `--ok`·`--warn` 변수가 없어서 `var(--ok, #2f9e44)`처럼 기본색을 함께 준다. 페이지에 변수를 만들면 그 값이 쓰인다.

### 안내와 학습 잠금

| 키 | 형식 | 설명 |
|---|---|---|
| `cpNotice`, `cpHasNotice` | 문자열, 불리언 | 오류·안내 문장(로그인 만료, 사용량 초과, 서버 오류, 409 등) |
| `cpLearningLocked` | 불리언 | 체크포인트 진행 중. 학습 입력과 추천 질문을 막는다 |
| `cpLearningLockedText` | 문자열 | 학습 탭 안내 '이해도 확인을 마치면 다시 질문할 수 있어요.' |
| `cpLearningInputOpacity` | 문자열 | 학습 입력 줄 투명도(잠겼으면 `.5`) |

### 나중에 이어 풀기

| 키 | 형식 | 설명 |
|---|---|---|
| `cpShowPauseButton`, `cpPauseLabel`, `onCpPause` | 불리언·문자열·핸들러 | 이해도 확인 탭의 [나중에 이어 풀기]. 답하는 중에만 |
| `cpConfirmPause`, `cpConfirmPauseText` | 불리언·문자열 | 확인창과 문구(재확인 대기 중이면 '판정은 저장되고 다른 재확인 질문으로' 문구) |
| `cpConfirmPauseYes`, `onCpConfirmPause` / `cpConfirmPauseNo`, `onCpCancelPause` | 문자열·핸들러 | 확인창 [멈추기] / [계속 풀기] |
| `cpIsPaused` | 불리언 | 멈춘 시도(`state = paused`). 진행 화면의 단계 표시는 '멈춤 · 1/3 완료', 입력창(`cpShowComposer`)은 숨김 |
| `cpShowResumeButton`, `cpResumeLabel`, `onCpResume` | 불리언·문자열·핸들러 | 이해도 확인 탭의 [이어 풀기 (1/3 완료)] |
| `cpShowResumeBanner`, `cpResumeBannerText`, `cpResumeBannerLabel` | 불리언·문자열 | 학습 탭 안내 "풀던 이해도 확인이 있어요 · 제선 1/3 완료" [이어 풀기](핸들러는 `onCpResume`). 오버레이에서 풀고 있는 동안은 숨긴다 |
| `cpShowPauseOffer`, `cpPauseOfferText`, `cpPauseOfferLabel`, `onCpPauseForLearning` | 불리언·문자열·핸들러 | 학습 탭 안내 "풀던 이해도 확인이 있어요. 잠깐 멈추고 질문할까요?" [멈추고 질문하기] |

### 공정 목록 섹션 버튼 (`sectionBadge(section)`)

공정 목록 각 섹션 끝의 상태 문구와 버튼. 설계는 [checkpoint-overlay.md](checkpoint-overlay.md). 이 섹션의 풀던 시도가 열려 있으면 진입 상태(`cpProgress`)보다 그 시도를 따른다(시작한 뒤에는 진입 상태를 다시 읽지 않는다).

| 키 | 형식 | 설명 |
|---|---|---|
| `cpSectionStatus` | 문자열 | 진입 상태 문장(`cpEntryStatus`와 같은 문장, 섹션 기준). 풀던 시도가 열려 있으면 '진행 중' · '멈춤 · 1/3 완료', 잠긴 섹션은 '이전 공정 통과 필요'(`TEXT.sectionLocked`) |
| `cpSectionLocked`, `cpSectionStatusColor` | 불리언·문자열 | 앞 공정을 통과하지 못해 열리지 않은 섹션(로그인 상태, 진행 상태 `open: false`). 상태 문구 색: 통과 초록, 잠김 주황, 그 밖 `var(--muted)` |
| `cpSectionPassed` | 불리언 | 통과한 섹션 |
| `cpSectionShowStart` | 불리언 | 버튼을 보여 줄지. 통과·로그인 전·준비 중·확인 중이면 숨기고 상태 문구만. 잠긴 섹션은 비활성 버튼으로 보인다 |
| `cpSectionCanStart`, `cpSectionStartOpacity`, `cpSectionCursor` | 불리언·문자열 | 누를 수 있는지(잠긴 섹션, 다른 섹션의 풀던 시도가 열려 있거나 요청 중이면 `false`, 투명도 `.45`, 커서 `not-allowed`) |
| `cpSectionStartLabel`, `onCpSectionStart` | 문자열·핸들러 | '담금질 시작하기' · '이어 풀기' · '재도전'. 핸들러는 `openSection(section)` |
| `cpSectionHasResume`, `cpSectionResumeText` | 불리언·문자열 | 이어 풀기 안내 "풀던 이해도 확인이 있어요 · 제선 1/3 완료". 오버레이가 열려 있으면 숨긴다 |

### 오버레이

3D 화면 위 이해도 확인. 말풍선은 이번 응답의 튜터 발화(`cpTurn`)를 [다음]으로 차례로 보여 주고, 캐릭터 동작은 지금 보이는 발화의 type으로 정한다. 입력 줄·준비·재채점·멈춤 확인창·결과는 위 진행·결과 화면 키를 그대로 쓴다.

| 키 | 형식 | 설명 |
|---|---|---|
| `cpShowOverlay` | 불리언 | 오버레이 표시(`cpOverlayOpen`이고 시도가 있거나 시작 요청 중) |
| `cpCharacterMotion` | 문자열 | 캐릭터 동작 이름표. 요청 중 `thinking`, 멈춘 시도·발화 없음 `idle`, 그 밖에는 `motionFor(말풍선 type)`: `intro` → `greet`, `question` → `ask`, `recheck_question` → `ask_again`, `feedback` → `praise`, `explanation` → `explain`, `key_points` → `encourage`, `error` → `sorry`, `result` → 통과면 `celebrate` 아니면 `cheer_retry` |
| `cpBubbleText`, `cpBubbleType`, `cpBubbleLabel`, `cpBubbleColor` | 문자열 | 말풍선 발화·type·머리말(`TEXT.messageLabels`)·색(재확인 주황, 채점 오류 빨강) |
| `cpBubbleHasNext`, `cpBubbleNextLabel`, `onCpBubbleNext` | 불리언·문자열·핸들러 | 이번 응답에 다음 발화가 있음 · [다음] |
| `cpCanAnswer` | 불리언 | 답할 수 있음: 답하는 중, 요청 중 아님, 마지막 발화(질문)를 보고 있음 |
| `cpOverlayInputDisabled`, `cpOverlayInputOpacity` | 불리언·문자열 | 오버레이 입력 막기(`cpCanAnswer`의 반대)와 입력 줄 투명도(막혔으면 `.5`) |
| `cpOverlayPlaceholder` | 문자열 | 오버레이 입력 안내. 다음 발화가 남았으면 '[다음]으로 질문까지 본 뒤 답할 수 있어요', 그 밖에는 단계별 안내 |
| `cpOverlayShowReady` | 불리언 | '준비됐어요' 버튼: 준비 단계에서 시작 인사를 끝까지 본 뒤 |
| `cpOverlayLockPointer`, `cpOverlayLockOpacity`, `cpOverlayLockFilter` | 문자열 | 오버레이가 떠 있는 동안 페이지의 공정 메뉴(공정 이동·설비·섹션 버튼)와 하단 재생 바를 막는 CSS 값: `none`·`.4`·`grayscale(1)`, 아니면 `auto`·`1`·`none` |
| `cpOverlayLockNotice` | 문자열 | 공정 메뉴 맨 위 안내 '담금질 중에는 공정 이동과 재생을 쓸 수 없어요'(`TEXT.overlayLocked`) |
| `cpOverlayShowResult` | 불리언 | 결과(게이지·막대): 결과 발화까지 본 뒤. 그때 캐릭터 동작이 `celebrate`·`cheer_retry`다 |
| `cpShowHistory`, `cpHistoryLabel`, `onCpToggleHistory` | 불리언·문자열·핸들러 | 대화 기록(`cpMessages`) 펼침 · '대화 기록' / '기록 닫기' |
| `cpExitLabel`, `onCpExit` | 문자열·핸들러 | [나가기](`exit()`) |

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
- 모드 탭, 학습 잠금(`lockLearning`·`runLearning`), 공정 배지(`sectionBadge`), site의 비활성 시작 버튼
- 오버레이: 동작 이름표(`motionFor`), 섹션 버튼으로 시작 → 말풍선 차례 보기·동작 전환 → 결과 → 나가기, 복원은 열지 않음, [나가기] → 멈춤 → 섹션 버튼으로 이어 풀기, 시작 실패·멈춘 시도 받기·다른 섹션 막기, [멈추고 질문하기]의 `openTutor`

캐릭터 동작이 기대는 엔진의 발화 약속(`feedback`은 맞혔을 때만 등)은 `backend/test/checkpoint.test.ts`의 '발화 type 약속' 테스트로 고정한다.

③에서는 브라우저로도 확인했다(#50 화면 기준): 가짜 평가자·튜터·학습 튜터를 넣은 서버에 headless Chrome으로 붙어 탭 전환, 시작 → 재확인 → 채점 오류 → 다시 채점 → 결과, 새로고침 복원, 체크포인트 중 학습 잠금과 3D 공정 이동, site에서 시작 불가, 학습 모드 질문·답변을 확인했다. 스크린샷은 `docs/screenshots/checkpoint-v2/`.

## 실제 Gemini로 확인하기

1. `.env`에 `GEMINI_API_KEY`를 넣고 `npm start`(접속 비밀번호를 쓰지 않으려면 `TEST_PASSCODE`를 비운다).
2. `http://localhost:3000/login`에서 `trainee01`~`10` 중 하나로 로그인한 뒤 `http://localhost:3000/`을 연다. 체크포인트 기록이 남으므로 끝나면 `npm run db:reset-user -- trainee0N --origin live`로 지울 수 있다.
3. 확인할 것:
   - 오른쪽 위 'AI 튜터' → 머리글이 '학습 모드 · 제철소 전체'이고 'mockTutor' 문구가 없다.
   - 학습 탭에서 질문하면 Gemini 답변과 근거가 나온다.
   - 공정 메뉴의 제선에 '미통과' 배지, 제강·연주·압연에는 배지가 없다.
   - 이해도 확인 탭: 전체 보기에서는 시작 버튼이 비활성, 제선으로 들어가면 '시작 전'과 활성 버튼.
   - 시작 → '준비됐어요' → 질문(단계 '개념 1/3'). 일부러 모르는 척 답하면 설명과 재확인 질문(단계 '개념 1/3 · 재확인', 주황 머리말 '다른 각도로 다시 물어볼게요').
   - 진행 중에 학습 탭으로 가면 안내 문구, 입력·전송 비활성. 설비 패널의 '튜터에게 묻기'도 동작하지 않는다. 3D 공정 이동은 된다.
   - 새로고침 후 'AI 튜터'를 열면 이해도 확인 탭에 진행 중인 시도가 그대로 있다.
   - 끝나면 결과 차트(이해도 %, 기준 80% 선, 개념별 막대)와 통과 안내. 통과하면 제선 배지가 '단련 완료'.
   - 채점 오류(평가자 형식 오류)는 일부러 내기 어렵다. 나오면 '다시 채점하기' 버튼이 보이는지 본다.

## 알려진 문제

- 결과 메시지 불일치(⑤에서 고침): 통과하면 엔진의 결과 문장(`result` 메시지)은 "제강 섹션이 열렸어요"라고 하지만, 제강 루브릭이 없으면 결과 카드는 "다음 공정은 준비 중이에요"라고 한다. 엔진 문장(`backend/src/checkpoint/engine.ts`)은 ③ 범위 밖이라 그대로 두었다. `checkpoint-test.html`도 같다.
- 루브릭이 없는 공정의 404(⑤에서 고침): 제강·연주·압연의 진입 상태 요청은 404가 정상인데, 브라우저가 콘솔에 'Failed to load resource'로 남긴다. 페이지를 열 때 3개, 공정을 옮길 때 1개씩 나온다.
- v2 `componentDidUpdate` 콘솔 오류([#15](https://github.com/viiin2/ST-ROOKIE/issues/15))는 #50 이후 headless 확인에서 0건이다. 이슈를 닫을지는 ④에서 CLAUDE.md를 갱신할 때 확인한다.
- #50 템플릿의 아이콘 주소(`<img src="{{ ic.logo }}">` 등)를 `support.js`가 채우기 전에 브라우저가 한 번 요청해 페이지를 열 때마다 404가 약 38개 난다. 아이콘은 정상으로 보인다. ③과 무관하다.

## PR 순서

각각 따로 내고, 모두 최신 `dev`에서 브랜치를 만든다.

| | 내용 | 조건 |
|---|---|---|
| ① | `checkpoint-chat.js`, `api-client.js`, `tutor-text.js`, 테스트, 이 문서 | 지금 |
| ② | `learning-chat.js`가 `api-client.js`를 쓰게 수정 | ssoyoum님 확인 후 |
| ③ | v2에 모드 탭 + 체크포인트 템플릿 연결 + 머리글 '가짜 튜터(mockTutor)' 문구 수정. 리뷰어 viiin2님 | ① 병합 후 |
| ④ | `?user=` 방식 제거(`request-user.ts`의 헤더 경로 등), 로그인 요청 외 모든 `/api` 로그인 필수, `TEST_PASSCODE` 제거, 로그인 시도 지연 또는 횟수 제한, `checkpoint-test.html` 정리, `tutor_v2.js` 삭제, CLAUDE.md 갱신 | ③ 병합 후 |
| ⑤ | 작은 수정 PR. 엔진 결과 문장이 다음 섹션의 루브릭 유무를 확인하게 수정(없으면 "다음 공정은 준비 중"). 섹션 목록 API에 루브릭 유무를 넣고(지금은 섹션별 `/api/sections/:section/progress`뿐이라 목록 API를 새로 둔다), 프론트는 루브릭이 있는 공정만 진입 상태를 요청 | ③ 병합 후 |

`tutor_v2.js`(가짜 튜터 `mockTutor`)는 viiin2님이 삭제해도 된다고 했다. 지금 불러오는 곳이 없다(옛 v1 `tutor.js`에도 같은 이름의 `mockTutor`가 있지만 별개 파일이다). ④에서 지울 때 참조하는 곳이 없는지 다시 확인하고(`grep -rn "tutor_v2\|mockTutor"`), 삭제만 별도 커밋으로 한다.

## 접속 비밀번호 정리 (④에서 함)

`TEST_PASSCODE`를 켜면 모든 `/api` 요청(로그인 포함)에 비밀번호가 필요한데, 비밀번호를 입력받는 곳은 `checkpoint-test.html`뿐이다. 입력칸을 새로 만들지 않고 ④에서 접속 비밀번호를 없애기로 했다. 그 대신 로그인으로 막는다.

- 로그인 요청(`/api/auth/*`의 로그인·회원가입·찾기) 외의 모든 `/api`는 로그인 필수
- `TEST_PASSCODE`와 `X-Test-Passcode` 검사(`backend/src/test-access.ts`) 제거
- 로그인 시도에 지연 또는 횟수 제한(터널 주소가 공개되므로 무차별 대입을 느리게 한다)
- `api-client.js`의 접속 비밀번호 헤더와 `setPasscode()` 제거

①~③ 동안에는 지금처럼 `TEST_PASSCODE`를 쓸 수 있고, `api-client.js`는 저장된 비밀번호가 있으면 헤더로 보낸다.
