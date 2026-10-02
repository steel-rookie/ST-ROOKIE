# 팀원 테스트 안내: 제선 이해도 확인

진행자 한 명이 자기 컴퓨터에서 서버를 켜고, cloudflared 임시 주소로 팀원에게 공유합니다. 팀원은 브라우저만 있으면 됩니다. 팀원의 답변은 AI 채점이 사람 판단과 얼마나 맞는지 확인하는 데 씁니다.

- [진행자용](#진행자용)
- [팀원용](#팀원용)
- [부록: 각자 로컬에서 실행하기](#부록-각자-로컬에서-실행하기)

---

## 진행자용

### 1. 준비 (처음 한 번)

```bash
git switch integrate/checkpoint   # 통합 PR이 dev에 병합된 뒤에는 dev
npm ci
brew install cloudflared        # Windows: winget install --id Cloudflare.cloudflared
```

`.env`에 다음 값을 넣습니다(`.env.example` 참고).

```
GEMINI_API_KEY=발급받은_키
GEMINI_MODEL=gemini-3.5-flash-lite
TEST_PASSCODE=팀원에게_알려줄_비밀번호
LLM_DAILY_LIMIT=150
```

- `TEST_PASSCODE`가 있으면 모든 `/api` 요청에 비밀번호를 확인합니다. 비어 있으면 `npm run tunnel`이 열리지 않습니다.
- `LLM_DAILY_LIMIT`는 팀원 한 명이 하루에 부를 수 있는 Gemini 호출 수입니다. 체크포인트 한 번에 보통 6~12회를 씁니다(재확인이 많을수록 늘어남).

### 2. 서버와 터널 켜기

터미널 두 개를 씁니다.

```bash
# 터미널 1
caffeinate -i npm start
# 터미널 2
caffeinate -i npm run tunnel
```

`caffeinate -i`(macOS)는 뒤의 명령이 끝날 때까지 컴퓨터가 절전에 들어가지 않게 합니다. 절전에 들어가면 터널이 끊겨 팀원이 접속할 수 없습니다. 화면 꺼짐은 막지 않으니 덮개를 닫지 말고 전원을 연결해 두세요.

터미널 2에 공유 주소가 나옵니다.

```
공유 주소가 준비됐습니다. 팀원에게 이름을 붙여 보내세요(접속 비밀번호는 따로 전달).
  https://xxxx-xxxx.trycloudflare.com/checkpoint-test.html?user=이름
```

- 서버는 이 컴퓨터(localhost)에서만 접속을 받고, 터널이 외부 요청을 넘겨줍니다.
- 주소는 터널을 켤 때마다 바뀝니다.

**공유하기 전에 확인하세요.** 터널을 연 뒤 1~2분 기다렸다가(새 주소가 퍼지는 시간), 비밀번호 없이 API를 불러 401이 나오는지 봅니다.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://xxxx-xxxx.trycloudflare.com/api/sections/ironmaking/progress
# 401이면 정상. 200이면 TEST_PASSCODE가 적용되지 않은 것이니 공유하지 말고 .env와 서버를 확인하세요.
```

### 3. 공유

- 팀원마다 `?user=` 뒤에 서로 다른 이름을 붙여 보냅니다. 예: `.../checkpoint-test.html?user=민수`. 이름이 같으면 기록이 섞입니다.
- 이해도 확인은 테스트 페이지(`/checkpoint-test.html`)에서만 합니다. 메인 화면(3D)에는 이해도 확인 버튼이 없습니다.
- 비밀번호는 주소와 다른 채널로 보냅니다.

### 4. 끝나면

1. 터미널 2에서 `Ctrl+C`로 터널을 닫습니다. 이때부터 주소로 접속할 수 없습니다.
2. `.env`의 `TEST_PASSCODE`를 다른 값으로 바꿉니다.
3. 답변을 평가 세트로 꺼냅니다: `npm run eval:export-human` (자세한 흐름은 `llm/eval/README.md`).

### 평가 다시 돌리기(긴 실제 Gemini 실행)

모은 답변으로 평가자를 다시 채점하거나 튜터 질문 표본을 만들 때는 몇십 분 걸리므로 절전을 막고 돌립니다.

```bash
caffeinate -i npm run eval:evaluator -- --set hard | tee hard-report.txt
caffeinate -i npm run eval:questions -- --polish-count 3 --out questions.md
```

- 케이스마다 결과가 `llm/eval/results/`에 바로 기록됩니다. 중간에 끊기면 같은 명령에 `--resume`을 붙여 이어서 실행합니다(끝난 케이스는 건너뜀).
- `--resume` 없이 다시 실행하면 기존 결과 파일을 덮어쓰지 않고 멈춥니다. 처음부터 하려면 결과 파일을 지웁니다.
- 자세한 옵션은 `llm/eval/README.md`.

### 기록 관리

- 한 사람의 기록을 지우고 처음부터 다시 하게 하려면: `npm run db:reset-user -- 민수`
  - 체크포인트 시도, 답변, 대화, 오개념, 하루 사용량을 지웁니다. 지우기 전에 한 번 묻습니다(`--yes`로 생략).
- 기록은 `data/st-rookie.sqlite`에 있습니다.

---

## 팀원용

### 접속

1. 진행자에게 받은 주소를 엽니다. 주소가 `/checkpoint-test.html?user=내이름`으로 끝나야 합니다. 예: `https://xxxx.trycloudflare.com/checkpoint-test.html?user=민수`
   - `?user=`가 없으면 이름 입력창이 나옵니다. 띄어쓰기 없이 입력하세요.
2. 접속 비밀번호를 묻는 창이 나오면 진행자에게 받은 비밀번호를 입력합니다.

### 이해도 확인 진입

1. 섹션 목록에서 **제선**의 **시작** 버튼을 누릅니다. 다른 섹션은 앞 섹션을 통과해야 열립니다.
2. '이해도 확인 · 제선'이 나오면 **준비됐어요**를 누릅니다.
3. 개념 3개를 차례로 묻습니다. 틀리거나 되물으면 튜터가 설명한 뒤 다른 각도로 한 번 더 묻습니다.
4. 끝나면 개념별 막대와 전체 이해도(기준 80%)가 나옵니다. 80%에 못 미치면 **섹션 목록으로**를 누른 뒤 **재도전**을 눌러 보세요. 어려웠던 개념만 다시 묻습니다.

진행 중에 새로고침해도 이어서 할 수 있습니다.

### 답할 때 지켜 주세요

- **검색하지 말고 아는 만큼만 답해 주세요.** 틀린 답, 반쯤 맞는 답이 가장 도움이 됩니다.
- **되묻기도 자유롭게 해 보세요.** "그게 무슨 뜻이에요?", "힌트 주세요", "모르겠어요"도 그대로 보내면 됩니다.
- 맞춤법이나 말투는 신경 쓰지 않아도 됩니다.
- 이름, 사번 같은 개인정보는 답변에 쓰지 마세요.
- 채점이 이상하다고 느끼면 개념 이름과 내 답변을 메모해 두었다가 진행자에게 알려 주세요.

### 문제가 생기면

| 증상 | 해결 |
|---|---|
| "튜터에 연결하지 못했습니다"(502) | **같은 답을 다시 보내세요.** 답변은 저장되지 않은 상태라 다시 보내도 됩니다. |
| "채점 오류"와 **다시 채점하기** 버튼 | 버튼을 누르면 방금 답변을 다시 채점합니다. |
| "오늘 쓸 수 있는 튜터 호출을 다 썼어요"(429) | 진행자에게 알려 주세요. |
| 비밀번호 창이 다시 뜸 | 비밀번호가 바뀌었거나 틀렸습니다. 진행자에게 확인하세요. |
| 주소가 열리지 않음 | 터널이 닫혔거나 주소가 바뀌었습니다. 진행자에게 새 주소를 받으세요. |

---

## 부록: 각자 로컬에서 실행하기

터널을 쓸 수 없을 때만 씁니다. 팀원마다 Gemini API 키가 필요합니다.

1. Node.js 22 이상 설치, [Google AI Studio](https://aistudio.google.com/app/apikey)에서 키 발급
2. `git clone https://github.com/viiin2/ST-ROOKIE.git && cd ST-ROOKIE && git switch integrate/checkpoint && npm ci` (통합 PR이 병합된 뒤에는 `dev`)
3. `.env.example`을 복사해 `.env`를 만들고 `GEMINI_API_KEY`만 채웁니다(`TEST_PASSCODE`는 비워 둠).
4. `npm start` 후 `http://localhost:3000/checkpoint-test.html?user=내이름`을 엽니다. 포트가 겹치면 `PORT=3001 npm start`(PowerShell: `$env:PORT=3001; npm.cmd start`).
5. 끝나면 서버를 끄고 `data/st-rookie.sqlite`를 `team-이니셜.sqlite`로 이름을 바꿔 진행자에게 보냅니다. 진행자는 `npm run eval:export-human -- --db team-a.sqlite --db team-b.sqlite`로 함께 꺼냅니다.
