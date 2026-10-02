// 관리자 대시보드 데이터. 화면에는 로그인한 관리자의 DB 응답만 표시한다.
// - GET /api/admin/trainees : docs/auth-api.md '관리자 통계' 형식 그대로
// - GET /api/admin/concepts : 개념(=설비)별 첫 판정 분포. concept_results + attempts로 집계

const TOKEN_KEY = 'st-rookie-token';
async function get(path) {
  let token = null; try { token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
  const res = await fetch(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
export async function loadAdminData() {
  const [trainees, concepts] = await Promise.all([
    get('/api/admin/trainees'), get('/api/admin/concepts'),
  ]);
  return { trainees, concepts };
}
