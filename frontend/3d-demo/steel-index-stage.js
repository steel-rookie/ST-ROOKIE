// 공정 무대(steel-index.js가 쓴다). 공정을 고르면 바닥판이 앞으로 쭉 뻗는다. 뒷벽은 쓰지 않는다(2026-10-14 요청: 대시보드를 벽이 아니라 공정 옆에 비스듬히 띄운다).
// 공정 이름(굵은 평면 글자, 글자마다 아래에서 위로 올라온다)은 왼쪽 뒤 위에, 온도 그래프는 왼쪽 앞에 서서, 작은 판 3장(아래 2·위 1)은 오른쪽에 떠 있다. 모두 반투명 유리판이고 카메라 쪽을 보되 ±25°쯤 비스듬하며, 켜질 때 아래에서 떠오르고 켜진 뒤에는 살짝 흔들린다.
//   - 공정 온도 흐름: 설비 단계별 대표 온도(data_v2.js의 steps[].temp)를 이은 주황 선 그래프. 고른 설비 구간을 밝게 표시
//   - 가장 뜨거운 구간: 공정(또는 고른 설비)에서 온도가 가장 높은 단계
//   - 소재 흐름: 들어오는 원료 → 나오는 소재(io), 설비·단계 수
//   - 학습 현황: 지금 보는 것 · 본 설비 수 · 이해도 확인 상태(서버 응답, 로그인 때만) · 다시 볼 설비 수
// 값은 data_v2.js와 서버 응답에서만 가져온다(꾸민 실시간 값 없음). 온도는 교육용 예시값이라 그래프에 그렇게 적는다.
// 바닥판 윗면 = y 0(설비가 여기서 솟는다). 바닥판 두께만큼 아래(-STAGE_H)까지 그리므로 steel-index.js의 전역 클리핑 평면도 그 높이에 맞춘다.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { parseTemp } from './steel-index-ui.js';

export const STAGE_H = 1.6;
const T = { floor: 650, wallAt: 220, wall: 820, titleAt: 700, title: 1000, panelAt: 1050, panelGap: 170, panel: 700, sink: 420 };
const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
const FONT = '"Noto Sans KR", "Pretendard", sans-serif', MONO = '"IBM Plex Mono", "JetBrains Mono", monospace';
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
// 너비 maxW 안에 들어가게 글자 크기를 줄인다(최대 size)
const fitFont = (x, text, weight, size, maxW, family = FONT) => { let s = size; x.font = `${weight} ${s}px ${family}`; while (s > 18 && x.measureText(text).width > maxW) { s -= 2; x.font = `${weight} ${s}px ${family}`; } return s; };

export function createStage({ scene, slateMap, reduced = false }) {
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.8, metalness: 0.15, roughnessMap: slateMap, bumpMap: slateMap, bumpScale: 0.08 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c2025, roughness: 0.88, metalness: 0.08, transparent: true });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x4a5058, transparent: true });
  const floorPivot = new THREE.Group(), wallPivot = new THREE.Group(), board = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1), boxEdges = new THREE.EdgesGeometry(box);
  const floor = new THREE.Mesh(box, floorMat); floor.receiveShadow = true; floorPivot.add(floor); floor.add(new THREE.LineSegments(boxEdges, lineMat));
  const wall = new THREE.Mesh(box, wallMat); wall.receiveShadow = true; wallPivot.add(wall); wall.add(new THREE.LineSegments(boxEdges, lineMat));
  [floor, wall].forEach((m) => { m.raycast = () => {}; });
  scene.add(floorPivot, wallPivot, board); floorPivot.visible = wallPivot.visible = board.visible = false;

  // 캔버스 한 장 = 판 하나(벽에 붙은 평면). draw(x, k)로 다시 그린다
  function plate(cw, ch, w, h) {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 3; mesh.raycast = () => {}; board.add(mesh); return { c, x: c.getContext('2d'), tex, mesh, w, h };
  }
  const glass = (x, W, H) => { x.clearRect(0, 0, W, H); x.fillStyle = 'rgba(10,14,20,.62)'; x.strokeStyle = 'rgba(255,255,255,.28)'; x.lineWidth = 3; x.beginPath(); x.roundRect(3, 3, W - 6, H - 6, 26); x.fill(); x.stroke(); };
  const head = (x, t, sub) => { x.fillStyle = '#9aa6b2'; x.font = `500 30px ${MONO}`; x.fillText(t, 40, 64); if (sub) { x.fillStyle = '#6f7b88'; x.font = `400 24px ${FONT}`; x.fillText(sub, 40, 102); } };

  let st = null, dark = true; // 지금 무대(공정 하나)
  function build(p) {
    const { w, d, cx, cz } = p.foot, size = p.bounds.getSize(new THREE.Vector3());
    const W = w + 12, D = d + 14, z0 = cz - d / 2 - 6, Hw = Math.max(18, size.y + 9), H = STAGE_H;
    floor.scale.set(W, H, D); floor.position.set(0, -H / 2, D / 2); floorPivot.position.set(cx, 0, z0);
    wallPivot.visible = false; board.position.set(0, 0, 0); // 뒷벽 없음. 판은 월드 좌표로 바로 놓는다
    board.children.slice().forEach((m) => { board.remove(m); m.geometry.dispose(); m.material.map.dispose(); m.material.dispose(); });
    // 배치: 카메라는 앞 왼쪽(yaw -0.3)에서 본다. 판은 그쪽을 보되 그래프는 +0.5, 작은 판은 -0.45만큼 비스듬히, 모두 뒤로 0.16 기울인다
    const yawCam = -0.3, lean = -0.16, put = (pl, x, y, z, yaw) => { pl.mesh.position.set(x, y, z); pl.mesh.rotation.set(lean, yaw, 0); pl.y0 = y; };
    const tw = Math.min(24, Math.max(14, w * 0.34)), title = plate(1024, 512, tw, tw / 2);
    put(title, cx - w * 0.18, Math.max(size.y, 8) + tw * 0.28, z0 + 4, yawCam + 0.1);
    const rw = Math.min(36, Math.max(18, w * 0.55)), gh = rw * 0.5, graph = plate(1600, 800, rw, gh);
    put(graph, cx - w / 2 - rw * 0.28, gh / 2 + 1.6, cz + d * 0.45, yawCam + 0.45);
    // 작은 판: 오른쪽에 아래 2장·위 1장. 판들이 놓인 면을 yawCam - 0.45로 돌린다
    const sw = Math.min(18, Math.max(11, w * 0.28)), sh = sw * 0.62, sx = cx + w / 2 + sw * 0.55, sz = cz + d * 0.25, th = yawCam - 0.4;
    const small = [0, 1, 2].map((i) => { const pl = plate(600, Math.round(600 * sh / sw), sw, sh), lx = (i < 2 ? i - 0.5 : 0) * (sw + 1), row = i < 2 ? 0 : 1;
      put(pl, sx + lx * Math.cos(th), 1.2 + sh / 2 + row * (sh + 0.8), sz - lx * Math.sin(th), th); return pl; });
    // 데이터: 설비 단계별 온도(상한), 설비 구간
    const pts = [], bands = [];
    p.eqs.forEach((e) => { const i0 = pts.length; (e.data.steps || []).forEach((s) => { const r = parseTemp(s.temp); if (r) pts.push({ v: r[1], zone: s.zone, temp: s.temp, eq: e }); }); if (pts.length > i0) bands.push({ eq: e, i0, i1: pts.length - 1 }); });
    st = { p, W, D, Hw, z0, title, graph, small, pts, bands, t0: 0, sink: null, k: { floor: 0, wall: 0, title: 0, graph: 0 }, learn: null, eq: null, fade: 1 };
    floorPivot.scale.set(1, 1, 0.0001); floorPivot.visible = board.visible = true;
    drawAll(true);
  }

  // ---- 그리기 ----
  function drawTitle(k) {
    const { x, c, tex } = st.title, D = st.p.data, chars = [...D.name], ink = dark ? '#ffffff' : '#141820', ink2 = dark ? '#c9d1d6' : '#3a4048';
    x.clearRect(0, 0, c.width, c.height); x.textBaseline = 'top';
    const size = Math.min(250, Math.floor(980 / Math.max(2, chars.length))); x.font = `900 ${size}px ${FONT}`; let px = 6; const lh = size * 1.1;
    chars.forEach((ch, i) => { const ki = Math.min(1, Math.max(0, k * (1 + 0.18 * chars.length) - 0.18 * i)), e = 1 - Math.pow(1 - ki, 4), wch = x.measureText(ch).width;
      x.save(); x.beginPath(); x.rect(px - 4, 0, wch + 8, lh + 6); x.clip(); x.fillStyle = ink; x.fillText(ch, px, 4 + (1 - e) * lh); x.restore(); px += wch * 0.97; });
    const a = Math.min(1, Math.max(0, (k - 0.4) / 0.5)); x.globalAlpha = a;
    const sub = `ST-ROOKIE · ${D.en} Process`, io = `${D.num} / 04   ${D.io || ''}`;
    x.fillStyle = ink2; fitFont(x, sub, 700, 58, c.width - 24); x.fillText(sub, 10, lh + 22);
    x.fillStyle = '#ff7a1a'; fitFont(x, io, 500, 34, c.width - 24, MONO); x.fillText(io, 12, lh + 104);
    x.globalAlpha = 1; tex.needsUpdate = true;
  }
  function drawGraph(k) { // 공정 온도 흐름(선이 왼쪽부터 그어진다)
    const { x, c, tex } = st.graph, Wc = c.width, Hc = c.height, P = st.pts; glass(x, Wc, Hc);
    head(x, 'TEMPERATURE FLOW · 공정 온도 흐름', '단계별 대표 온도 · 교육용 예시값');
    if (P.length < 2) { x.fillStyle = '#9aa6b2'; x.font = `400 30px ${FONT}`; x.fillText('온도 자료가 없어요', 40, Hc / 2); tex.needsUpdate = true; return; }
    const l = 120, r = Wc - 48, t = 140, b = Hc - 92, max = 2000, X = (i) => l + (r - l) * i / (P.length - 1), Y = (v) => b - (b - t) * Math.min(1, v / max);
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 2; x.fillStyle = '#6f7b88'; x.font = `400 24px ${MONO}`;
    [0, 500, 1000, 1500, 2000].forEach((v) => { x.beginPath(); x.moveTo(l, Y(v)); x.lineTo(r, Y(v)); x.stroke(); x.fillText(`${fmt(v)}`, 40, Y(v) - 12); });
    st.bands.forEach((bd, j) => { const x0 = X(bd.i0) - (bd.i0 ? (X(1) - X(0)) / 2 : 0), x1 = X(bd.i1) + (bd.i1 < P.length - 1 ? (X(1) - X(0)) / 2 : 0), on = st.eq === bd.eq;
      if (on) { x.fillStyle = 'rgba(255,122,26,.12)'; x.fillRect(x0, t - 10, x1 - x0, b - t + 10); }
      if (j) { x.strokeStyle = 'rgba(255,255,255,.1)'; x.setLineDash([6, 8]); x.beginPath(); x.moveTo(x0, t - 10); x.lineTo(x0, b); x.stroke(); x.setLineDash([]); }
      x.fillStyle = on ? '#ffd2a8' : '#8f9aa6'; x.font = `${on ? 700 : 500} 26px ${FONT}`; const nm = bd.eq.data.name, tw = x.measureText(nm).width; x.fillText(nm, Math.max(x0 + 6, (x0 + x1) / 2 - tw / 2), b + 22); });
    const n = Math.max(1, Math.floor(k * (P.length - 1) + 1e-6)), frac = k * (P.length - 1) - (n - 1), last = Math.min(P.length - 1, n);
    const pts = P.slice(0, n).map((q, i) => [X(i), Y(q.v)]); if (k < 1 && last < P.length) { const a = P[n - 1], bq = P[last]; pts.push([X(n - 1) + (X(last) - X(n - 1)) * Math.min(1, frac), Y(a.v + (bq.v - a.v) * Math.min(1, frac))]); }
    const g = x.createLinearGradient(0, t, 0, b); g.addColorStop(0, 'rgba(255,122,26,.42)'); g.addColorStop(1, 'rgba(255,122,26,0)');
    x.beginPath(); x.moveTo(pts[0][0], b); pts.forEach(([a, v]) => x.lineTo(a, v)); x.lineTo(pts[pts.length - 1][0], b); x.closePath(); x.fillStyle = g; x.fill();
    x.save(); x.shadowColor = 'rgba(255,140,40,.9)'; x.shadowBlur = 18; x.strokeStyle = '#ff8a2a'; x.lineWidth = 6; x.lineJoin = 'round'; x.beginPath(); pts.forEach(([a, v], i) => (i ? x.lineTo(a, v) : x.moveTo(a, v))); x.stroke(); x.restore();
    if (k >= 1) { const hi = P.reduce((m, q, i) => (q.v > P[m].v ? i : m), 0), hx = X(hi), hy = Y(P[hi].v);
      x.strokeStyle = 'rgba(255,210,168,.6)'; x.setLineDash([5, 6]); x.lineWidth = 2; x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx, b); x.stroke(); x.setLineDash([]);
      x.save(); x.shadowColor = '#ff8a2a'; x.shadowBlur = 20; x.fillStyle = '#ffb066'; x.beginPath(); x.arc(hx, hy, 11, 0, Math.PI * 2); x.fill(); x.restore(); }
    tex.needsUpdate = true;
  }
  function hottest(list) { return list.reduce((m, q) => (!m || q.v > m.v ? q : m), null); }
  function drawHot() {
    const { x, c, tex } = st.small[0], Wc = c.width, Hc = c.height; glass(x, Wc, Hc);
    const list = st.eq ? st.pts.filter((q) => q.eq === st.eq) : st.pts, h0 = hottest(list), h = h0 && { ...h0, temp: h0.temp.replace(/^[→~\s]+/, '') }; // 데이터의 '→ 약 200℃' 같은 앞 화살표는 뺀다
    head(x, st.eq ? 'HOTTEST · 이 설비' : 'HOTTEST · 공정');
    if (!h) { x.fillStyle = '#9aa6b2'; x.font = `400 30px ${FONT}`; x.fillText('온도 자료가 없어요', 40, 170); tex.needsUpdate = true; return; }
    x.save(); x.shadowColor = 'rgba(255,140,40,.8)'; x.shadowBlur = 16; x.fillStyle = '#ffb066'; fitFont(x, h.temp, 800, 72, Wc - 80); x.fillText(h.temp, 40, Hc * 0.52); x.restore();
    x.fillStyle = '#e6ebf1'; fitFont(x, h.zone, 700, 34, Wc - 80); x.fillText(h.zone, 40, Hc * 0.52 + 54); x.fillStyle = '#8f9aa6'; x.font = `400 28px ${FONT}`; x.fillText(`${h.eq.data.name} · 교육용 예시값`, 40, Hc * 0.52 + 100);
    tex.needsUpdate = true;
  }
  function drawFlow() {
    const { x, c, tex } = st.small[1], Wc = c.width, Hc = c.height, D = st.p.data; glass(x, Wc, Hc);
    head(x, 'MATERIAL FLOW · 소재 흐름');
    const [a, b] = (D.io || '').split('→').map((s) => s.trim());
    x.fillStyle = '#c3ccd7'; fitFont(x, a || '-', 500, 32, Wc - 80); x.fillText(a || '-', 40, Hc * 0.4);
    x.fillStyle = '#ff9a2e'; x.font = `700 38px ${MONO}`; x.fillText('→', 40, Hc * 0.4 + 52);
    x.fillStyle = '#ffffff'; fitFont(x, b || '-', 800, 56, Wc - 136); x.fillText(b || '-', 96, Hc * 0.4 + 60);
    const steps = st.p.eqs.reduce((s, e) => s + (e.data.steps || []).length, 0);
    x.fillStyle = '#8f9aa6'; x.font = `400 28px ${MONO}`; x.fillText(`설비 ${st.p.eqs.length} · 단계 ${steps}`, 40, Hc - 44);
    tex.needsUpdate = true;
  }
  function drawLearn() {
    const { x, c, tex } = st.small[2], Wc = c.width, Hc = c.height, L = st.learn || {}; glass(x, Wc, Hc);
    head(x, 'LEARNING · 학습 현황');
    x.fillStyle = '#8f9aa6'; x.font = `400 26px ${FONT}`; x.fillText('지금 보는 것', 40, 150); x.fillText('본 설비', Wc * 0.58, 150);
    x.fillStyle = '#ffffff'; x.font = `700 36px ${FONT}`; const now = L.now || '공정 전체'; fitFont(x, now, 700, 36, Wc * 0.58 - 60); x.fillText(now, 40, 198);
    x.font = `800 52px ${MONO}`; x.fillText(`${L.seen ?? 0}`, Wc * 0.58, 202); const sw = x.measureText(`${L.seen ?? 0}`).width; x.fillStyle = '#8f9aa6'; x.font = `400 32px ${MONO}`; x.fillText(` / ${L.total ?? st.p.eqs.length}`, Wc * 0.58 + sw, 202);
    const tone = { ok: '#5fd39a', warn: '#f5b13d' }[L.cpTone] || '#c3ccd7';
    x.fillStyle = '#8f9aa6'; x.font = `400 26px ${FONT}`; x.fillText('이해도 확인', 40, Hc - 96);
    x.fillStyle = tone; fitFont(x, L.cp || '불러오는 중…', 700, 30, L.review ? Wc * 0.55 : Wc - 80); x.fillText(L.cp || '불러오는 중…', 40, Hc - 54);
    if (L.review) { x.fillStyle = '#f5b13d'; x.font = `700 28px ${FONT}`; const t = `다시 볼 설비 ${L.review}`; x.fillText(t, Wc - 40 - x.measureText(t).width, Hc - 54); }
    tex.needsUpdate = true;
  }
  function drawAll(initial) { drawTitle(initial ? 0 : st.k.title); drawGraph(initial ? 0 : st.k.graph); drawHot(); drawFlow(); drawLearn(); }

  function play(now) { if (!st) return; st.t0 = now; st.sink = null; if (reduced) { st.t0 = now - 1e5; } }
  function sink(now) { if (st) st.sink = { t0: now, from: { floor: floorPivot.scale.z, wall: wallPivot.scale.y } }; }
  function setTheme(isDark) {
    dark = isDark; floorMat.color.setHex(dark ? 0x2c3036 : 0x9aa0a8); wallMat.color.setHex(dark ? 0x1c2025 : 0xc4c9d0); lineMat.color.setHex(dark ? 0x4a5058 : 0xd6dade);
    if (st) drawTitle(st.k.title);
  }
  function setEquipment(e) { if (!st || st.eq === e) return; st.eq = e; drawGraph(st.k.graph); drawHot(); }
  function setLearning(info) { if (!st) return; st.learn = info; drawLearn(); }

  const _cam = new THREE.Vector3();
  function tick(now, camera) {
    if (!st) return;
    if (st.sink) { // 거꾸로: 대시보드·글자가 먼저 사라지고 벽이 내려가고 바닥이 접힌다
      const s = now - st.sink.t0, kp = ease(s / (T.sink * 0.35)), kw = ease((s - T.sink * 0.25) / T.sink), kf = ease((s - T.sink * 0.55) / T.sink);
      board.children.forEach((m) => { m.material.opacity = Math.min(m.material.opacity, 1 - kp); }); // 글자·대시보드가 먼저 꺼진다
      wallPivot.scale.y = Math.max(0.0001, st.sink.from.wall * (1 - kw)); floorPivot.scale.z = Math.max(0.0001, st.sink.from.floor * (1 - kf));
      if (now - st.sink.t0 > T.sink * 1.6) { floorPivot.visible = board.visible = false; st = null; }
      return;
    }
    const t = now - st.t0, K = st.k;
    K.floor = ease(t / T.floor); K.wall = ease((t - T.wallAt) / T.wall);
    floorPivot.scale.z = Math.max(0.0001, K.floor); wallPivot.scale.y = Math.max(0.0001, K.wall);
    const kt = Math.min(1, Math.max(0, (t - T.titleAt) / T.title)); if (kt !== K.title) { K.title = kt; drawTitle(kt); }
    const kg = Math.min(1, Math.max(0, (t - T.panelAt) / (T.panel * 2.2))); // 그래프 선은 판이 켜진 뒤 왼쪽부터 그어진다
    if (kg > 0 && K.graph !== kg) { K.graph = kg; drawGraph(kg); }
    [st.title, st.graph, ...st.small].forEach((pl, i) => {
      const k = i === 0 ? Math.min(1, kt * 3) : ease((t - T.panelAt - (i - 1) * T.panelGap) / T.panel);
      pl.mesh.material.opacity = Math.min(0.94, k) * st.fade;
      pl.mesh.position.y = pl.y0 + (1 - k) * 2.5 + (reduced ? 0 : Math.sin(now / 1400 + i * 1.3) * 0.12); // 아래에서 떠오르고, 켜진 뒤 살짝 흔들린다
    });
  }
  // 카메라가 무대 전체(바닥판 + 떠 있는 판들)를 담는 데 쓰는 상자
  function bounds() { if (!st) return null; const { cx } = st.p.foot, b = new THREE.Box3(new THREE.Vector3(cx - st.W / 2, 0, st.z0), new THREE.Vector3(cx + st.W / 2, 0.1, st.z0 + st.D)); [st.title, st.graph, ...st.small].forEach((pl) => { pl.mesh.updateMatrixWorld(true); b.expandByObject(pl.mesh); }); return b; }
  return { build, play, sink, tick, setTheme, setEquipment, setLearning, bounds };
}
