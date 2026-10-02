# 관리자 대시보드

신입사원 학습 현황을 조회하는 관리자 전용 화면. **조회만** 한다(수정·삭제·응시 없음).
현재 신입사원 통계는 실제 API, 오답률 높은 개념은 샘플이다(`GET /api/admin/concepts` 미구현).

- 화면: `frontend/login_ui/Admin Dashboard.dc.html`
- 데이터: `frontend/login_ui/admin_data.js` (샘플 + `loadAdminData()`)
- 명세(JSON): [admin-spec.json](admin-spec.json)
- 근거: [CLAUDE.md](../CLAUDE.md) '계정과 관리자'·'오개념 기록'·'점수 규칙', [docs/auth-api.md](auth-api.md) '관리자 통계'

## 들어가는 법

1. `npm start` 후 `http://localhost:3000/login`
2. 로그인 화면에서 **관리자** 탭 → `admin01` (비밀번호 `DEMO_PASSWORD`, 기본 `steel-2026-demo`)
3. 관리자 통계 → **관리자 대시보드 열기**

직접 주소는 `/login_ui/Admin%20Dashboard.dc.html`. 파일을 브라우저에서 바로 열면 API를 못 불러 샘플로 보인다(헤더 배지 `샘플 데이터`).

## 결정 (2026-10-02)

- 목표는 지금 화면을 **실데이터로 마무리**하는 것이다. 새 기능은 아래 '남은 작업'의 최소 보강만 한다.
- 관리자는 **조회만** 한다. 강제 해금, 기록 초기화, 계정 관리는 만들지 않는다(재응시 409·점수 규칙을 우회하는 경로가 생긴다).
- 오개념은 사람별 개수에 더해 **개념별 개수**까지 보여 준다. 사용자 id·답변 원문·오개념 설명은 넣지 않는다. CLAUDE.md '오개념 기록'의 "관리자 화면에는 사람별 개수만"을 바꾸는 결정이므로 팀에 공유하고 CLAUDE.md를 작은 PR로 고친다.
- `GET /api/admin/concepts`는 viiin2가 `backend/src/admin/`에 작은 PR로 만든다. 관리자 라우터는 `ironmaking-server.ts`에서 붙이므로 `app.ts`는 건드리지 않는다. 수민 담당 테이블(`concept_results`, `misconceptions`)을 읽기만 하므로 PR 전에 수민에게 알린다.

## 화면 구성

| 영역 | 보여 주는 것 | 데이터 |
|---|---|---|
| 요약 숫자 | 신입사원 수 · 전 과정 수료 · 평균 이해도 · 미해결 오개념 | trainees |
| 오답률 높은 개념 | 첫 답변이 정답이 아닌 비율 TOP 8, 공정 필터, 틀림/부분/힌트 막대 | concepts |
| 전 과정 수료 | 4개 공정 모두 통과한 사람, 평균 이해도, 재도전 횟수 | trainees |
| 확인이 필요한 사람 | 재도전 필요 · N일 미접속 · 오개념 많음 · 미시작 | trainees |
| 섹션별 진행 | 공정별 통과/미통과, 평균 이해도, 평균 시도 | trainees |
| 신입사원 명단 | 공정별 이해도·시도, 잠김, 진도, 오개념 수, 마지막 학습, 상태. 상태 필터·검색·정렬 | trainees |

라이트/다크 전환은 헤더 오른쪽 버튼.

## API

| 요청 | 상태 | 설명 |
|---|---|---|
| `GET /api/admin/trainees` | 구현됨 | 신입사원별 섹션 이해도·통과·시도·오개념 개수·마지막 학습일 ([auth-api.md](auth-api.md)) |
| `GET /api/admin/concepts` | **제안, 미구현** | 개념별 첫 판정 분포. 없으면 이 영역만 샘플 |

둘 다 `Authorization: Bearer <token>`(`st-rookie-token`), `admin`만. 아니면 `403 ADMIN_ONLY`.

### `GET /api/admin/concepts` (제안)

```json
{ "concepts": [
  { "section": "ironmaking", "concept_id": "hot_stove",
    "asked": 9, "partial": 2, "wrong": 4, "assisted": 1, "final_wrong": 2, "open": 3 }
] }
```

- 집계: `concept_results` ⨝ `attempts`(`state = 'completed'`, trainee만). 첫 질문의 `verdict` 기준, 재도전 시도 포함.
- `final_wrong`: 재확인 후에도 0점(`recheck_verdict = 'wrong'`).
- `open`: 이 개념의 미해결 오개념 수(전체 합).
- 답변 원문·오개념 설명·사용자 id는 **넣지 않는다**.
- `name`: 화면에 쓸 개념 이름. 실제 체크포인트의 `concept_id`는 **루브릭 개념 id**(`sinter_purpose`, `coke_reduction`, `blast_furnace_hot_metal`)라서 설비 id가 아니다. 설비 id를 쓰는 것은 시연 기록(`demo-records.ts`)뿐이다. 그래서 서버가 루브릭 `name`(없으면 설비 이름, 그것도 없으면 id)을 붙여 준다. 지금 화면은 `data_v2.js`의 설비 목록에서만 이름을 찾아 실데이터에서는 id가 그대로 보인다.

## 계산 규칙 (프론트)

- 통과 기준: 이해도 **80%**.
- 개념 오답률 = `(partial + wrong + assisted) / asked`. 내림차순, 같으면 `wrong` 많은 순.
- 잠김: 앞 섹션이 없거나 미통과면 뒤 섹션은 `잠김`.
- 상태(위에서부터 먼저 맞는 것):

| 상태 | 조건 |
|---|---|
| 수료 | `passed_sections === 4` |
| 재도전 필요 | 끝냈지만 `passed = false`인 섹션이 있음 |
| 진행 중 | 기록 있는 섹션이 하나 이상 |
| 미시작 | 모든 섹션 `null` |

- 확인이 필요한 사람: 재도전 필요 > 3일 이상 미접속(수료 제외) = 미해결 오개념 3개 이상(수료·재도전 제외) > 미시작.

## 개인정보

- 오개념은 **개수만** 본다. 내용·답변 원문은 본인 마이페이지에서만 보인다.
- 사번은 관리자 화면에만 표시한다.

## 화면 상태

| 상태 | 표시 |
|---|---|
| 불러오는 중 | 헤더 `불러오는 중…` |
| API 둘 다 실패 | 배지 `샘플 데이터` |
| trainees만 성공 | 배지 `실시간 · 개념 통계는 샘플` |
| 둘 다 성공 | 배지 `실시간 데이터` |
| `checkpoint_data: false` | 계정 목록만, 모든 칸 `미응시` |

## 파일 구조

```
frontend/login_ui/
  Admin Dashboard.dc.html   화면(템플릿 + class Component). support.js가 실행
  admin_data.js             SAMPLE_TRAINEES, SAMPLE_CONCEPTS, loadAdminData()
  My Page.dc.html           관리자 통계에 대시보드 링크
```

- 공정·설비 이름은 `data_v2.js`의 `PROCESSES`에서 가져온다. 저장소에서는 import 경로를 `../3d-demo/data_v2.js`로 맞춘다.
- 실제 API만 쓰려면 `loadAdminData()`에서 샘플 fallback을 지운다.

## 남은 작업

백엔드 (작은 PR 1개, viiin2)
- [ ] `backend/src/admin/`에 `GET /api/admin/concepts`(위 형식, `name` 포함). `requireUser, requireAdmin`은 trainees와 같다.
- [ ] `backend/test/admin.test.ts`에 추가: 401·403, 첫 판정 분포, 진행 중 시도 제외, trainee만 집계, 응답에 원문·사용자 id 없음.
- [ ] `docs/auth-api.md` '관리자 통계'에 concepts를 추가한다.

프론트 (`Admin Dashboard.dc.html`, `admin_data.js`)
- [ ] 개념 이름은 API의 `name`을 먼저 쓰고, 없을 때만 설비 이름으로 찾는다.
- [ ] 하단 문구 "모든 교육 내용과 기록은 샘플입니다"는 샘플일 때만 보인다.
- [ ] 토큰이 없거나 `401`이면 `/login`으로 보낸다. `403`(trainee)은 아래 '정할 것'에 따른다. 지금은 실패하면 조용히 샘플로 바뀌어 실데이터처럼 보인다.

최소 보강 (선택)
- [ ] 마지막 학습일에 학습 모드 대화(`learning_turns`)도 반영한다. 지금은 체크포인트 시도(`attempts`)만 봐서 학습 모드만 한 사람이 '미접속'으로 잡힌다. `trainee-stats.ts` 변경이다.

## 정할 것

- [x] `GET /api/admin/concepts` 담당자: viiin2, 작은 PR (위 '결정')
- [ ] 개념별 오개념 **개수** 노출: 보여 주기로 결정, 팀 공유와 CLAUDE.md 반영 대기
- [ ] 개념 이름을 서버가 붙일지(`name`), 루브릭 개념과 설비를 잇는 `equipment_ids`(CLAUDE.md '다음 단계', 수민 담당)를 기다릴지 (백엔드·수민)
- [ ] 미접속 경고 기준 3일 (교육 담당)
- [ ] trainee가 대시보드 주소로 직접 들어올 때 `/login`으로 보낼지 (프론트)
- [ ] 명단 CSV 내보내기 필요 여부 (교육 담당)
