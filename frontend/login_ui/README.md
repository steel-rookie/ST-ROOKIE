# login_ui

로그인 + 마이페이지 화면. `frontend/login_ui/`에 둔다.

- `My Page.dc.html`: 로그인·회원가입·아이디 찾기·비밀번호 찾기 + 마이페이지. 서버를 켜고(`npm start`) http://localhost:3000/login 으로 연다. 파일을 바로 열면 로그인 API를 부를 수 없다.
- 로그인 후 같은 `My Page.dc.html` 주소에서 신입사원과 관리자는 같은 스타일의 대시보드를 본다. 역할에 따라 각자의 화면을 표시한다.
- `Admin Dashboard.dc.html`: 관리자 화면. `/api/admin/trainees`와 `/api/admin/concepts`의 DB 통계를 표시한다.
- `Trainee Dashboard.dc.html`: 신입사원 화면. `/api/me/dashboard`에서 본인 기록만 읽고 학습 모듈을 표시한다.
- `support.js`: 화면 런타임(3d-demo의 것과 동일).
- 교육 내용은 `../3d-demo/data_v2.js`를 읽는다(중복 없음). 3D 학습 링크도 `../3d-demo/`를 가리킨다.
- API 형식은 [docs/auth-api.md](../../docs/auth-api.md).

## 로그인 화면 구성
- 일반 사용자 / 관리자 토글: 서버(`GET /api/auth/demo-accounts`)가 준 시연 계정(지금 `trainee01`~`20`, `admin01`)을 그대로 보여 준다. 화면에 계정 목록을 따로 적지 않는다.
- 아이디·비밀번호는 밑줄 입력칸. 비밀번호 아래에 시연 비밀번호를 회색 글씨로 보여 준다.
- 로그인 상태 유지: 켜면 토큰 7일 + `localStorage`, 끄면 12시간 + `sessionStorage`.
- 아래 링크: 아이디 찾기(이름 + 사번), 비밀번호 찾기(아이디 + 이름 + 사번 → 새 비밀번호), 회원가입(이름, 사번, 아이디, 비밀번호).

## 마이페이지 구성

- 공통: 프로필, 주요 수치, 섹션별 진행 카드와 DB 연결 상태.
- 관리자: 전체 신입사원 명단, 섹션 통계, 오답률 높은 개념. 기록이 없거나 API가 실패하면 샘플 수치 대신 빈 상태 또는 오류를 표시한다.
- 신입사원: 본인 섹션 통과 수, 평균 이해도, 복습할 개념과 오개념, 제강 2D 학습 모듈.
- 시연 계정 생성 코드는 `dev`에 머지된 #29에서 가져왔다. `npm run db:seed-demo -- 58`은 `trainee01`~`20`의 기존 시연 체크포인트 기록을 다시 만든다.
