// 관리자 대시보드 데이터. 샘플(실제 기록 아님). 서버가 있으면 실제 API를 먼저 시도한다.
// - GET /api/admin/trainees : docs/auth-api.md '관리자 통계' 형식 그대로
// - GET /api/admin/concepts : (제안, 아직 없음) 개념(=설비)별 첫 판정 분포. concept_results + attempts로 집계
export const SECTIONS = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];

const iso = (daysAgo, h = 10) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 20, 0, 0); return d.toISOString(); };
const s = (understanding, passed, attempts) => ({ understanding, passed, attempts });

export const SAMPLE_TRAINEES = {
  checkpoint_data: true,
  sections: SECTIONS,
  trainees: [
    { id: 't1', username: 'trainee01', name: '김신입', employee_no: 'T2026001', created_at: iso(9), last_activity: iso(0, 9),
      sections: { ironmaking: s(0.92, true, 1), steelmaking: s(0.86, true, 1), continuous_casting: s(0.83, true, 2), rolling: s(0.88, true, 1) }, passed_sections: 4, misconceptions: { open: 0, resolved: 3 } },
    { id: 't2', username: 'trainee02', name: '이신입', employee_no: 'T2026002', created_at: iso(9), last_activity: iso(0, 14),
      sections: { ironmaking: s(0.85, true, 1), steelmaking: s(0.81, true, 2), continuous_casting: null, rolling: null }, passed_sections: 2, misconceptions: { open: 2, resolved: 2 } },
    { id: 't3', username: 'trainee03', name: '박신입', employee_no: 'T2026003', created_at: iso(9), last_activity: iso(1, 16),
      sections: { ironmaking: s(0.82, true, 2), steelmaking: s(0.57, false, 2), continuous_casting: null, rolling: null }, passed_sections: 1, misconceptions: { open: 4, resolved: 1 } },
    { id: 't4', username: 'trainee04', name: '최신입', employee_no: 'T2026004', created_at: iso(9), last_activity: iso(2, 11),
      sections: { ironmaking: s(0.64, false, 1), steelmaking: null, continuous_casting: null, rolling: null }, passed_sections: 0, misconceptions: { open: 3, resolved: 0 } },
    { id: 't5', username: 'trainee05', name: '정다은', employee_no: 'T2026005', created_at: iso(8), last_activity: iso(0, 11),
      sections: { ironmaking: s(1, true, 1), steelmaking: s(0.9, true, 1), continuous_casting: s(0.93, true, 1), rolling: s(0.81, true, 2) }, passed_sections: 4, misconceptions: { open: 0, resolved: 2 } },
    { id: 't6', username: 'trainee06', name: '한도윤', employee_no: 'T2026006', created_at: iso(8), last_activity: iso(0, 17),
      sections: { ironmaking: s(0.88, true, 1), steelmaking: s(0.83, true, 1), continuous_casting: s(0.71, false, 2), rolling: null }, passed_sections: 2, misconceptions: { open: 2, resolved: 1 } },
    { id: 't7', username: 'trainee07', name: '오세린', employee_no: 'T2026007', created_at: iso(7), last_activity: iso(3, 15),
      sections: { ironmaking: s(0.9, true, 1), steelmaking: s(0.95, true, 1), continuous_casting: s(0.85, true, 1), rolling: s(0.92, true, 1) }, passed_sections: 4, misconceptions: { open: 1, resolved: 1 } },
    { id: 't8', username: 'trainee08', name: '윤재민', employee_no: 'T2026008', created_at: iso(2), last_activity: null,
      sections: { ironmaking: null, steelmaking: null, continuous_casting: null, rolling: null }, passed_sections: 0, misconceptions: { open: 0, resolved: 0 } },
  ],
};

// asked: 첫 질문 받은 횟수 / partial·wrong·assisted: 첫 판정 분포 / final_wrong: 재확인 후에도 0점 / open: 미해결 오개념 수
const c = (section, concept_id, asked, partial, wrong, assisted, final_wrong, open) => ({ section, concept_id, asked, partial, wrong, assisted, final_wrong, open });
export const SAMPLE_CONCEPTS = {
  concepts: [
    c('ironmaking', 'sinter_plant', 9, 2, 1, 0, 0, 0), c('ironmaking', 'coke_oven', 9, 2, 2, 1, 1, 1), c('ironmaking', 'blast_furnace', 9, 3, 2, 1, 1, 2),
    c('ironmaking', 'hot_stove', 9, 2, 4, 1, 2, 3), c('ironmaking', 'taphole_casthouse', 8, 1, 1, 0, 0, 0), c('ironmaking', 'torpedo_car', 8, 0, 1, 0, 0, 0),
    c('steelmaking', 'hot_metal_pretreatment', 7, 2, 2, 0, 1, 1), c('steelmaking', 'bof_converter', 7, 2, 3, 1, 1, 2), c('steelmaking', 'oxygen_lance_offgas', 7, 1, 2, 0, 1, 1),
    c('steelmaking', 'tapping_ladle_crane', 7, 1, 0, 0, 0, 0), c('steelmaking', 'secondary_refining', 7, 3, 2, 1, 2, 2), c('steelmaking', 'ladle_transfer', 6, 0, 1, 0, 0, 0),
    c('continuous_casting', 'ladle_turret', 5, 1, 0, 0, 0, 0), c('continuous_casting', 'tundish', 5, 1, 1, 0, 0, 0), c('continuous_casting', 'cc_mold', 5, 1, 2, 1, 1, 1),
    c('continuous_casting', 'secondary_cooling', 5, 2, 1, 0, 1, 1), c('continuous_casting', 'withdrawal_straightener', 5, 1, 2, 0, 1, 0), c('continuous_casting', 'torch_cutter', 4, 0, 0, 0, 0, 0),
    c('rolling', 'reheating_furnace', 3, 0, 0, 0, 0, 0), c('rolling', 'descaler', 3, 1, 0, 0, 0, 0), c('rolling', 'roughing_mill', 3, 0, 1, 0, 0, 0),
    c('rolling', 'finishing_mill', 3, 1, 1, 0, 0, 0), c('rolling', 'runout_table', 3, 1, 1, 0, 1, 1), c('rolling', 'coiler', 3, 0, 0, 0, 0, 0),
  ],
};

const TOKEN_KEY = 'st-rookie-token';
async function get(path) {
  let token = null; try { token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
  const res = await fetch(path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
// 실제 서버에 붙이면 source가 'api'로 바뀐다. 개념 통계 API가 아직 없으면 그 부분만 샘플.
export async function loadAdminData() {
  const out = { trainees: SAMPLE_TRAINEES, concepts: SAMPLE_CONCEPTS, source: { trainees: 'sample', concepts: 'sample' } };
  try { out.trainees = await get('/api/admin/trainees'); out.source.trainees = 'api'; } catch (e) {}
  try { out.concepts = await get('/api/admin/concepts'); out.source.concepts = 'api'; } catch (e) {}
  return out;
}
