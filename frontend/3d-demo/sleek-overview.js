// [세련안] Steel Academy sleek.dc.html 전용 덧붙임. scene_v3.js는 고치지 않고 site-*.js처럼 바깥에서 붙는다.
// 1) 드론 시점: 전체 공정을 낮고 비스듬한 각도로 본다(_overviewPose 대체)
// 2) 인트로: 어두운 화면에서 조명이 서서히 켜진다
// 3) 정리: 공정 사이 빛나는 연결선·길 빛, 보케·불씨·불꽃놀이, 바닥 빛기둥, 구역 네온 테두리를 끈다
// 4) 공정 안을 볼 때 카메라와 공정 사이를 가리는 주변 건물을 숨긴다
// 끝나면 document에 'sleek-intro-done' 이벤트를 보낸다(페이지가 안내 문구를 띄움).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { PROCESSES } from './data_v2.js';

const IDS = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];
const LIGHT_MS = 3200;

export function attachSleek() {
  const tryAttach = () => {
    const el = document.querySelector('steel-scene');
    const ready = el && el.scene && el.zones && IDS.every(id => el.zones[id]?.root?.getObjectByName('GLB_' + id)) && el.scene.getObjectByName('SITE_BACKDROP_EXT');
    if (!ready) return setTimeout(tryAttach, 120);
    if (el.__sleek) return; el.__sleek = true;
    setupDroneView(el);
    const tidy = () => tidyScene(el);
    tidy(); setInterval(tidy, 500); // 새로 생기는 것도 잡는다
    let burstUntil = 0;
    const burst = () => { if (performance.now() < burstUntil) { tidy(); setTimeout(burst, 16); } }; // 그리기(rAF)와 상관없이 약 60번/초
    new MutationObserver(() => { const go = performance.now() >= burstUntil; burstUntil = performance.now() + 3000; tidy(); if (go) setTimeout(burst, 16); })
      .observe(el, { attributes: true, attributeFilter: ['theme', 'time-of-day', 'timeofday'] });
    setInterval(() => hideOccluders(el), 400);
    // 조작(드래그·휠) 처리는 지금 바로 붙이고, 공정 소개는 인트로가 끝난 뒤 시작한다(인트로 중 휠이 원래 거리 줌으로 새던 문제)
    const showcase = startShowcase(el);
    playIntro(el, showcase);
  };
  tryAttach();
}

// ---- 1) 드론 시점 ----
const MAX_DIST = 200; // 전체 공정에서 카메라가 물러날 수 있는 최대 거리(원래 300)
// 라이트 모드의 해: 첫 화면(드론 시점) 기준 2시 방향 하늘(고도 40°). 그림자는 이 방향으로 바닥에 구워 둔다(bakeSunShadow)
const SUN = (() => { const yaw = -0.55, f = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw)), r = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw));
  const a = Math.PI / 3, h = f.multiplyScalar(Math.cos(a)).add(r.multiplyScalar(Math.sin(a))).normalize(), el = 40 * Math.PI / 180; // 2시 = 12시(앞쪽 멀리)에서 오른쪽으로 60°
  return new THREE.Vector3(h.x * Math.cos(el), Math.sin(el), h.y * Math.cos(el)).normalize(); })();
function setupDroneView(el) {
  const PITCH = 0.42, YAW = -0.55;
  // 오른쪽 드래그로도 돌린다: 장면은 오른쪽 버튼도 회전으로 처리하므로, 브라우저 오른쪽 클릭 메뉴만 막는다
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // 라이트 모드에선 실시간 햇빛도 구운 그림자와 같은 방향(2시)에서 비추게
  const placeSun = el._placeSun.bind(el);
  el._placeSun = function () { if ((this.getAttribute('theme') || 'dark') !== 'dark') this._sunDir = SUN.clone(); return placeSun(); };
  el._placeSun();
  // 전체 공정에서 좌우로 240°(드론 시점 기준 ±120°)까지 돌려 볼 수 있게 한다. 공정 안에서는 원래 범위
  const yawRange = el._yawRange.bind(el);
  el._yawRange = function () { return this.orbit.dist > 120 ? [YAW - 2.09, YAW + 2.09] : yawRange(); };
  el._overviewPose = function () {
    const zs = Object.values(this.zones || {}), xs = zs.map(z => z.ox), zz = zs.map(z => z.oz || 0);
    const x0 = Math.min(...xs) - 26, x1 = Math.max(...xs) + 26, z0 = Math.min(...zz) - 22, z1 = Math.max(...zz) + 28;
    // 화각은 늘 기본 42°로 계산한다(소개 중엔 20°로 당겨져 있어, 그대로 쓰면 거리가 두 배 넘게 잡혀 멀리 빠졌다)
    const a = this.camera.aspect || 1.6, t = Math.tan(42 * Math.PI / 360);
    const span = Math.hypot(x1 - x0, z1 - z0); // 비스듬히 보므로 대각선 길이로 맞춘다
    const dist = Math.max(140, Math.min(MAX_DIST, span / (2 * t * Math.min(a, 1.8)) * 1.05));
    // 화면 앞쪽(04 열간압연)이 잘리지 않게 시선 중심을 카메라 쪽으로 조금 당긴다
    const fwd = new THREE.Vector3(Math.sin(YAW), 0, Math.cos(YAW)).multiplyScalar(14);
    return this._navShift({ yaw: YAW, pitch: PITCH, dist, target: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2).add(fwd) });
  };
}

// ---- 3) 잡다한 것 끄기 ----
function tidyScene(el) {
  let changed = false;
  // 원래 장면 코드(scene_v3.js·site-backdrop.js)가 테마를 바꿀 때 네온·빛기둥 등을 다시 켜서, 잠깐씩 예전 모습이 비쳤다.
  // 그래서 숨길 것은 visible 속성을 잠가 버린다(켜려 해도 무시)
  const off = (o) => { if (!o || o.userData.sleekOff) return; Object.defineProperty(o, 'visible', { configurable: true, get: () => false, set: () => {} }); o.userData.sleekOff = true; changed = true; };
  removeBlockers(el, off); // 그림자를 굽기 전에 먼저 지운다(지운 건물 그림자가 바닥에 남지 않게)
  off(el._links?.g);                                   // 공정 사이 하늘색 연결선
  (el.zoneArrows || []).forEach(a => { if (a.el && a.el.style.display !== 'none') { a.el.style.display = 'none'; changed = true; } off(a.mesh); off(a.glow); });
  (el._bokehPts || []).forEach(off);                  // 보케(먼 도시 불빛 점)
  off(el.embers);                                      // 불씨
  if (el._fw) { off(el._fw.pts); off(el._fw.glow); }   // 불꽃놀이
  Object.values(el.zones || {}).forEach(z => off(z.neon)); // 구역 네온 테두리
  // 원래 상자 이름표(01 제선 …)는 쓰지 않는다. 대신 동그라미 콜아웃(makeCallout). display는 장면이 만지므로 visibility로 숨긴다
  Object.values(el.zones || {}).forEach(z => { if (z.label && z.label.style.visibility !== 'hidden') { z.label.style.visibility = 'hidden'; z.label.style.pointerEvents = 'none'; } });
  const beams = el.scene.getObjectByName('SITE_FLOOR_BEAMS'); off(beams); // 바닥 빛기둥
  // 바닥 조명 본체: 빛기둥과 같은 개수로 깔린 납작한 원판(주변 건물 GLB 안). 이것도 숨긴다
  if (beams?.isInstancedMesh) beams.parent?.traverse(o => { if (o !== beams && o.isInstancedMesh && o.count === beams.count && !o.userData.lamp) off(o); });
  off(el._waves?.g);                                   // 바다 물결 줄(땅 모양이 달라 땅 위까지 덮음)
  (el._sharks || []).forEach(off);                    // 바다 위 상어(지느러미·그림자·물살)
  // 가로등 3D(기둥·등머리·빛 번짐·아래 주황 원)는 모두 숨긴다. 빛은 바닥 라이트맵에 구워 둔다(bakeLampLight)
  el.scene.traverse(o => { if (!o.userData.lamp) return; if (!lampPool && o.geometry?.type === 'CircleGeometry' && o.isInstancedMesh) lampPool = o; off(o); });
  // 낮·밤 배경 GLB는 각자 바닥(SITE_GROUND)을 갖는다. 지금 보이는 것을 고른다
  let ground = null; el.scene.traverse(o => { if (o.name === 'SITE_GROUND' && o.material && isShown(o)) ground = o; });
  const dark = (el.getAttribute('theme') || 'dark') === 'dark';
  if (ground) {
    const m = ground.material;
    // scene_v3.js의 _applyTheme이 테마를 바꿀 때·60초마다 바닥 지도를 다시 칠하므로, 바뀌면 다시 입힌다
    if (m.map !== m.userData.myBase) { asphaltGround(el, m, dark); changed = true; }
    if (!dark && !m.userData.myBase?.userData.sunBaked && m.userData.myBase) { try { bakeSunShadow(el, ground, m.userData.myBase); } catch (e) { console.warn('그림자 굽기 실패', e); } m.userData.myBase.userData.sunBaked = true; changed = true; }
    if (lampPool && !m.userData.lampBaked) { m.userData.lampBaked = true; try { bakeLampLight(ground, lampPool); } catch (e) { console.warn('가로등 빛 굽기 실패', e); } changed = true; }
    const lmi = dark ? 13.8 : 0; if (m.lightMap && m.lightMapIntensity !== lmi) { m.lightMapIntensity = lmi; changed = true; } // 낮에는 가로등이 꺼져 있다
    if (!ground.userData.sea) { try { ground.userData.sea = makeSea(el, ground); } catch (e) { console.warn('바다 만들기 실패', e); ground.userData.sea = 'fail'; } changed = true; }
    if (ground.userData.sea?.setTheme) ground.userData.sea.setTheme(dark);
  }
  if (!dark) lightContrast(el);
  moonlight(el, dark);
  if (!dark) placeSunDisc(el);
  if (!dark) { const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'); if (ext && isShown(ext) && ground && !ground.userData.chiaro) { ground.userData.chiaro = true; /* 낮·밤 배경 GLB마다 바닥이 따로라 거기에 표시 */ try { bakeChiaroscuro(el, ext); } catch (e) { console.warn('명암 굽기 실패', e); } changed = true; } }
  if (!el.__sleekRoads && el._traffic) el.__sleekRoads = buildRoads(el) || 'none';
  if (el.__sleekRoads?.setTheme) el.__sleekRoads.setTheme(dark);
  if (changed) el._dirty = true;
}
const isShown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

// 바닥: 그려진 도로·차선 줄은 흐려 지우고(땅·바다 색 구분은 남김), 그 위에 잘게 반복되는 노이즈를 얹어
// 아스팔트처럼 자글자글하게(서브스턴스 디자이너 add noise 느낌). 노이즈는 자체 발광으로 넣어 밤에도 결이 보인다.
// 흐린 바닥 그림은 원본 텍스처(낮·밤)마다 따로 만든다.
let noiseTex = null, lampPool = null;
const baseCache = new Map(), landCache = new Map(); // 원본 지도(낮·밤) → 흐린 바닥 그림 / 땅 마스크
function asphaltGround(el, m, dark) {
  const src = m.map, img = src?.image;
  if (img) {
    // 땅 마스크 먼저(바다 칸을 또렷하게 도려낼 때와, 땅 그림을 흐릴 때 바다 색이 섞이지 않게 할 때 함께 쓴다)
    let L = landCache.get(src);
    if (!L) {
      const N = 1024, canvas = seaMaskCanvas(img, N), sx = canvas.getContext('2d'), sd = sx.getImageData(0, 0, N, N), d = sd.data;
      // 바깥 바다와 이어진 물만 바다로 남긴다: 가장자리 바다 칸에서 출발해 번져 나가고, 땅에 둘러싸인 '바다'(공정 아래 판 등)는 땅으로 메운다
      const sea = new Uint8Array(N * N), q = new Int32Array(N * N); let qh = 0, qt = 0;
      const push = (i) => { if (!sea[i] && d[i * 4] > 127) { sea[i] = 1; q[qt++] = i; } };
      for (let k = 0; k < N; k++) { push(k); push((N - 1) * N + k); push(k * N); push(k * N + N - 1); }
      while (qh < qt) { const i = q[qh++], x = i % N, y = (i / N) | 0; if (x > 0) push(i - 1); if (x < N - 1) push(i + 1); if (y > 0) push(i - N); if (y < N - 1) push(i + N); }
      // 바다 위 작은 '땅' 조각(원본 지도에 그려진 물결 점선이 땅처럼 밝아 남은 것)은 바다로 되돌린다: 땅 덩어리마다 넓이를 재서 작으면 지운다
      const seen = new Uint8Array(N * N), comp = new Int32Array(N * N);
      for (let s0 = 0; s0 < N * N; s0++) {
        if (sea[s0] || seen[s0]) continue;
        let h = 0, t = 0; comp[t++] = s0; seen[s0] = 1;
        while (h < t) { const i = comp[h++], x = i % N, y = (i / N) | 0; for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1]) if (j >= 0 && !sea[j] && !seen[j]) { seen[j] = 1; comp[t++] = j; } }
        if (t < 1500) for (let k = 0; k < t; k++) sea[comp[k]] = 1; // 1500칸(≈590㎡) 미만은 물결 점선으로 본다
      }
      for (let i = 0; i < N * N; i++) { const v = sea[i] ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; } // 땅=흰색
      sx.putImageData(sd, 0, 0);
      const tex = new THREE.CanvasTexture(canvas); tex.flipY = src.flipY;
      L = { canvas, tex }; landCache.set(src, L);
    }
    m.alphaMap = L.tex; m.alphaTest = 0.5;

    let base = baseCache.get(src);
    if (!base) {
      // 도로·차선 줄은 흐려 지우되, 땅 칸끼리만 섞는다: 바다를 투명하게 비운 뒤 흐리면 캔버스가 투명도를 나눠 주어
      // 해안선 근처 땅에 바다 색이 번져 들어오지 않는다. 마지막에 다시 불투명하게 채운다
      const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
      const t = document.createElement('canvas'); t.width = t.height = N; const tx = t.getContext('2d');
      tx.drawImage(img, 0, 0, N, N);
      const mk = document.createElement('canvas'); mk.width = mk.height = N; const mkx = mk.getContext('2d'), md = mkx.createImageData(N, N), ld = L.canvas.getContext('2d').getImageData(0, 0, N, N).data;
      for (let i = 0; i < N * N; i++) { md.data[i * 4 + 3] = ld[i * 4]; } mkx.putImageData(md, 0, 0); // 땅=불투명
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mk, 0, 0);
      x.filter = 'blur(6px)'; x.drawImage(t, 0, 0); x.filter = 'none';
      const bd = x.getImageData(0, 0, N, N); for (let i = 3; i < bd.data.length; i += 4) bd.data[i] = 255; x.putImageData(bd, 0, 0);
      base = new THREE.CanvasTexture(c); base.colorSpace = src.colorSpace; base.flipY = src.flipY; base.wrapS = src.wrapS; base.wrapT = src.wrapT; base.anisotropy = 4;
      baseCache.set(src, base);
    }
    m.map = base; m.userData.myBase = base;
  }
  if (!noiseTex) {
    const n = document.createElement('canvas'); n.width = n.height = 256; const nx = n.getContext('2d'), im = nx.createImageData(256, 256);
    for (let i = 0; i < im.data.length; i += 4) { const r = Math.random(), v = 8 + r * r * 120; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    nx.putImageData(im, 0, 0);
    noiseTex = new THREE.CanvasTexture(n); noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping; noiseTex.repeat.set(36, 36); noiseTex.colorSpace = THREE.SRGBColorSpace; noiseTex.anisotropy = 8; // 알갱이 하나 ≈ 0.07m: 너무 잘면 멀리서 평균색으로 뭉개진다
  }
  m.emissiveMap = noiseTex; m.emissive.set(0x50545b); m.emissiveIntensity = 1;
  m.needsUpdate = true;
}

// 공정을 가리는 주변 모델 지우기(사용자 표시): 위치 범위로 고른다(낮·밤 배경 GLB 모두 같은 배치)
// - 열간압연 바로 앞(카메라 쪽) 긴 건물 묶음, 연주 앞 흰 탑 무리
// - 공장 안쪽(공정 사이)에 놓인 컨테이너·트럭(인스턴스): 부두·배 위 것은 남기고 안쪽 것만 크기 0으로
const BLOCKER_AREAS = [{ x0: -30, x1: 2, z0: 72, z1: 100 }, { x0: -76, x1: -50, z0: 14, z1: 33 }];
function removeBlockers(el, off) {
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'); if (!ext) return;
  ext.traverse(o => {
    if (!o.isMesh || o.userData.sleekChecked) return; o.userData.sleekChecked = true;
    if (o.isInstancedMesh) {
      o.geometry.computeBoundingBox(); const g = o.geometry.boundingBox.getSize(new THREE.Vector3());
      const container = Math.abs(g.x - 6) < 0.3 && Math.abs(g.y - 2.4) < 0.3, truck = g.x > 1.5 && g.x < 5.5 && g.y < 1.7 && g.z < 2.2 && g.z > 1.9;
      if (!container && !truck) return;
      const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), W = new THREE.Vector3();
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.decompose(P, Q, S); W.copy(P).applyMatrix4(o.matrixWorld); if (W.z > -30) { S.setScalar(0); M.compose(P, Q, S); o.setMatrixAt(i, M); } }
      o.instanceMatrix.needsUpdate = true; el._dirty = true; return;
    }
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    if (BLOCKER_AREAS.some(a => c.x > a.x0 && c.x < a.x1 && c.z > a.z0 && c.z < a.z1)) off(o);
  });
}

// ---- 라이트 모드: 소묘처럼 명암을 물체에 구워 넣는다(주변 건물·탱크·굴뚝·나무) ----
// 밝은 면 → 중간톤 → 명암 경계(코어 섀도, 가장 어두움) → 반사광(그늘 안쪽이 바닥 반사로 살짝 밝아짐) + 드리운 그림자 + 바닥 쪽 접지 그림자.
// 해(SUN)에서 본 깊이 지도를 한 번 그려 다른 물체에 가려지는지(드리운 그림자) 판별하고, 꼭짓점마다 명암을 계산해 꼭짓점 색으로 저장한 뒤
// 조명 계산이 없는 재질(MeshBasicMaterial)로 바꾼다 → 이 물체들은 실시간 조명 비용이 0. 밝은 쪽은 살짝 따뜻하게, 그늘은 푸르스름하게.
function bakeChiaroscuro(el, ext) {
  const R = el.renderer, S = el.scene, RES = 2048, L = SUN.clone();
  // 1) 해에서 본 깊이 지도(직교). 깊이는 해 쪽 카메라에서 잰 거리를 float로 그대로 쓴다
  const cam = new THREE.OrthographicCamera(-360, 360, 360, -360, 1, 2400); cam.position.copy(L).multiplyScalar(1000); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const dmat = new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    vertexShader: 'varying float vD; void main(){ vec4 p = vec4(position, 1.);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n vec4 mv = viewMatrix * modelMatrix * p; vD = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vD; void main(){ gl_FragColor = vec4(vD, 0., 0., 1.); }' });
  const hidden = [];
  S.traverse(o => { if (!o.visible) return; if (o.name === 'SITE_GROUND' || o.name === 'SLEEK_SEA' || o.name === 'SLEEK_ROADS' || o.isPoints || o.isLine || o.isSprite) { o.visible = false; hidden.push(o); } });
  const bg = S.background, fog = S.fog, cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha(), tm = R.toneMapping;
  const rt = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.FloatType }), depth = new Float32Array(RES * RES * 4);
  try { S.background = null; S.fog = null; S.overrideMaterial = dmat; R.toneMapping = THREE.NoToneMapping; R.setClearColor(0x000000, 1); R.setRenderTarget(rt); R.clear(); R.render(S, cam); R.readRenderTargetPixels(rt, 0, 0, RES, RES, depth); }
  finally { R.setRenderTarget(null); S.overrideMaterial = null; S.background = bg; S.fog = fog; R.toneMapping = tm; R.setClearColor(cc, ca); hidden.forEach(o => { o.visible = true; }); rt.dispose(); dmat.dispose(); }
  const VP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), q = new THREE.Vector4(), camPos = cam.position;
  const lit = (w) => { // 0 = 완전히 가려짐, 1 = 해가 닿음 (3×3 칸 평균으로 가장자리를 부드럽게)
    q.set(w.x, w.y, w.z, 1).applyMatrix4(VP); const u = (q.x / q.w + 1) / 2 * RES, v = (q.y / q.w + 1) / 2 * RES; if (u < 1 || v < 1 || u > RES - 2 || v > RES - 2) return 1;
    const d = camPos.clone().sub(w).dot(L); // 해 쪽 카메라에서 잰 깊이(깊이 지도와 같은 기준)
    let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const z = depth[(((v | 0) + dy) * RES + ((u | 0) + dx)) * 4]; if (!z || d <= z + 0.6) n++; } return n / 9; };
  // 2) 명암 단계(소묘): d = 면이 해를 향하는 정도(-1~1)
  const g = (x) => Math.pow(Math.max(0, x), 2.2); // 화면 밝기 → 선형
  const tone = (d, ny, y, sun) => {
    let v;
    if (ny > 0.75) v = 0.9 + 0.12 * Math.max(0, d);                        // 윗면: 하늘을 봐서 밝게
    else if (d > 0) v = 0.7 + 0.36 * Math.min(1, d * 1.25) + (d > 0.93 ? 0.05 : 0); // 중간톤 → 밝은 면 (+하이라이트)
    else v = 0.52 + 0.195 * Math.min(1, Math.max(0, (-d - 0.2) / 0.8));   // 명암 경계(0.52) → 반사광(0.715)  (처음 값의 1.3배)
    v += (Math.min(v, 0.6) - v) * sun;                                      // 드리운 그림자(sun 0~1)만큼 그늘 밝기(0.6)로
    v *= 0.86 + 0.14 * Math.min(1, Math.max(0, y / 3));                     // 바닥 쪽 접지 그림자(어둡게 하는 양 30% 줄임)
    const shade = 1 - Math.min(1, v);                                       // 어두울수록 푸르게, 밝을수록 따뜻하게
    return [g(v * (1.0 - shade * 0.1)), g(v * (0.985 - shade * 0.05)), g(v * (0.95 + shade * 0.12))];
  };
  const P = new THREE.Vector3(), N = new THREE.Vector3(), NM = new THREE.Matrix3(), M = new THREE.Matrix4(), IM = new THREE.Matrix4();
  ext.updateMatrixWorld(true);
  ext.traverse(o => {
    if (!o.isMesh || o.name === 'SITE_GROUND' || o.userData.sleekOff || !o.material || Array.isArray(o.material) || o.material.isShaderMaterial) return;
    const geo = o.geometry.clone(); if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal, col = new Float32Array(pos.count * 3);
    const base = o.isInstancedMesh ? (o.getMatrixAt(0, IM), M.multiplyMatrices(o.matrixWorld, IM)) : o.matrixWorld;
    NM.getNormalMatrix(base);
    for (let i = 0; i < pos.count; i++) {
      P.fromBufferAttribute(pos, i).applyMatrix4(base); N.fromBufferAttribute(nor, i).applyMatrix3(NM).normalize();
      const d = N.dot(L), sunBlock = o.isInstancedMesh || d <= 0 ? 0 : 1 - lit(P.clone().addScaledVector(N, 0.25));
      const c = tone(d, N.y, P.y, sunBlock); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); o.geometry = geo;
    if (o.isInstancedMesh) { // 인스턴스마다 드리운 그림자 정도 → instanceColor
      const ic = new Float32Array(o.count * 3); for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, IM); P.setFromMatrixPosition(M.multiplyMatrices(o.matrixWorld, IM)); P.y += 1; const s2 = 0.55 + 0.45 * lit(P); ic[k * 3] = ic[k * 3 + 1] = s2; ic[k * 3 + 2] = Math.min(1, s2 * 1.05); }
      o.instanceColor = new THREE.InstancedBufferAttribute(ic, 3);
    }
    const m = o.material;
    o.material = new THREE.MeshBasicMaterial({ color: m.color, map: m.map || null, vertexColors: true, transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest });
  });
  el._dirty = true;
}

// 하늘의 해 원판·빛무리를 그림자 반대쪽(햇빛이 오는 2시 방향)으로 옮긴다. 원래 코드는 남서쪽 하늘 고정이라 빛 방향과 어긋났다.
// 방향(방위)은 SUN과 같게, 높이는 화면에 보이도록 수평선 바로 위(8°). 거리는 원래대로
function placeSunDisc(el) {
  const h = new THREE.Vector2(SUN.x, SUN.z).normalize(), e = 8 * Math.PI / 180;
  el.backdrop?.children.forEach(o => {
    if (!o.isMesh || o.geometry.type !== 'CircleGeometry' || o.geometry.parameters.radius < 25 || o.userData.sleekSun) return;
    const R = o.position.length(); if (R < 400) return;
    o.position.set(h.x * Math.cos(e) * R, Math.sin(e) * R, h.y * Math.cos(e) * R); o.lookAt(0, 20, 0); o.userData.sleekSun = true; el._dirty = true;
  });
}

// 다크 모드 달빛: 은은한 푸른 하늘빛(달빛 반사)을 한 겹 더 깔아 그늘까지 푸르스름하게 살짝 밝히고,
// 주 방향광은 차가운 달빛 색으로. 공정만 밝게 떠 보이지 않게 주변(건물·바닥·나무)에도 빛이 깔린다. 라이트 모드에선 끈다
function moonlight(el, dark) {
  let m = el.scene.getObjectByName('SLEEK_MOONLIGHT');
  if (!m) { m = new THREE.HemisphereLight(0x8fa8e0, 0x18202e, 0); m.name = 'SLEEK_MOONLIGHT'; el.scene.add(m); }
  const want = dark ? 0.75 : 0; let ch = false;
  if (Math.abs(m.intensity - want) > 1e-3) { m.intensity = want; ch = true; }
  const sun = el.sunLight;
  if (dark && sun && (Math.abs(sun.intensity - 1.55) > 1e-3 || sun.color.getHex() !== 0xbcd0ff)) { sun.intensity = 1.55; sun.color.set(0xbcd0ff); ch = true; }
  if (ch) el._dirty = true;
}

// 라이트 모드 입체감: 사방에서 고르게 밝히는 환경광을 줄이고(건물 0.3), 하늘빛도 줄이고, 2시 방향 햇빛을 세게.
// 상자는 해 받는 면/반대 면 차이가, 실린더는 빛 방향으로 밝다가 어두워지는 그라데이션이 살아난다. (원래 코드가 되돌려도 계속 맞춘다)
function lightContrast(el) {
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT');
  // (바닥 SITE_GROUND는 원래 밝기 유지)
  ext?.traverse(o => { if (o.isMesh && o.name !== 'SITE_GROUND' && o.material && o.material.envMapIntensity !== undefined && !o.material.userData.sleekEnv) { o.material.envMapIntensity = 0.3; o.material.userData.sleekEnv = true; o.material.needsUpdate = true; } });
  const h = el.hemiLight, sun = el.sunLight; let ch = false;
  if (h && Math.abs(h.intensity - 0.36) > 1e-3) { h.intensity = 0.36; h.groundColor.set(0x4a5160); ch = true; }
  if (sun && Math.abs(sun.intensity - 2.7) > 1e-3) { sun.intensity = 2.7; sun.color.set(0xfff1dd); ch = true; }
  if (ch) el._dirty = true;
}

// 바닥 지도 좌표: 바닥 판은 x·z 모두 -320~320. 캔버스 가로 = x, 세로 0행 = 남쪽(z=+320)
const GX = (x, N) => (x + 320) / 640 * N, GY = (z, N) => (320 - z) / 640 * N;

// 차가 다니는 경로를 따라 도로를 3D 면으로 깐다(바닥 그림에 칠하면 확대할 때 픽셀이 깨져서). 어떤 배율에서도 가장자리가 깔끔하다.
// - 구간마다 사각형 + 꺾이는 점마다 원 → 둥글게 이어진 띠. 연석(조금 넓게) 위에 아스팔트 면을 얹는다
// - 바닥 색에 '곱해' 그린다: 구워 둔 햇빛 그림자·가로등 빛이 도로 위에도 이어진다
// - 스텐실로 화면 한 칸에 한 번만 칠한다: 겹치는 곳(교차로·이음매)이 더 진해지지 않고 한 면으로 합쳐진다
function buildRoads(el) {
  const paths = [...new Set((el._traffic?.cars || []).map(c => c.path))];
  if (!paths.length) return null;
  const ribbon = (half) => {
    const pos = [], push = (x, z) => pos.push(x, 0, z);
    paths.forEach(pa => {
      const P = pa.P;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz) || 1, nx = -dz / L * half, nz = dx / L * half;
        push(a.x + nx, a.y + nz); push(b.x + nx, b.y + nz); push(b.x - nx, b.y - nz);
        push(a.x + nx, a.y + nz); push(b.x - nx, b.y - nz); push(a.x - nx, a.y - nz);
      }
      P.forEach(q => { const n = 20; for (let k = 0; k < n; k++) { const t0 = k / n * Math.PI * 2, t1 = (k + 1) / n * Math.PI * 2; push(q.x, q.y); push(q.x + Math.cos(t1) * half, q.y + Math.sin(t1) * half); push(q.x + Math.cos(t0) * half, q.y + Math.sin(t0) * half); } });
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
  };
  const layer = (half, ref, order, y) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.MultiplyBlending, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      stencilWrite: true, stencilRef: ref, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    const mesh = new THREE.Mesh(ribbon(half), m); mesh.position.y = y; mesh.renderOrder = order; mesh.raycast = () => {}; return mesh;
  };
  const g = new THREE.Group(); g.name = 'SLEEK_ROADS';
  const curb = layer(4.3, 1, 3, 0.03), road = layer(3.7, 2, 4, 0.04);
  g.add(curb, road); el.scene.add(g);
  return { setTheme(dark) { curb.material.color.setScalar(dark ? 0.82 : 0.9); road.material.color.setScalar(dark ? 0.62 : 0.66); el._dirty = true; } }; // 곱하는 값: 연석은 살짝, 아스팔트는 더 어둡게(연석 위에 겹쳐 곱해짐)
}

// ---- 라이트 모드: 2시 방향 햇빛 그림자를 바닥 그림에 한 번 구워 넣는다(실시간 그림자 계산 없음) ----
// 실제 그림자처럼: 물체에 붙은 곳은 날카롭고 진하게, 물체에서 멀어질수록(= 해를 가린 부분이 땅에서 높을수록) 넓게 풀리고 옅게.
// 1) 위에서 내려다보는 직교 카메라로 모든 물체를 '해 반대쪽 바닥에 눕힌 모양'(평면 투영)으로 그리되, 그 칸을 가린 부분의 높이를 함께 기록한다
//    (여러 부분이 겹치면 가장 낮은 것 = 가장 가까운 가림을 남긴다: 깊이값을 높이로 써서 깊이 테스트로 고름)
// 2) 칸마다 그 높이에 비례해 흐림 반경을 정하고(여러 단계로 흐린 그림자 중에서 골라 섞음), 높을수록 옅게
// 3) 물체 바로 밑 접지 그림자(수직 투영)를 좁게 흐려 더한다 → 바닥 색에 곱한다(푸른 회색 그림자)
function bakeSunShadow(el, ground, baseTex) {
  const R = el.renderer, S = el.scene, RES = 1024, PX = 640 / RES; // 한 칸 = 0.625m
  const cam = new THREE.OrthographicCamera(-320, 320, 320, -320, 1, 3000); cam.position.set(0, 1500, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uK: { value: new THREE.Vector2() } },
    vertexShader: 'uniform vec2 uK; varying float vH; void main(){ vec4 p = vec4(position, 1.);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n vec4 w = modelMatrix * p; vH = max(w.y, 0.); w.xz -= uK * vH; w.y = 0.; vec4 c = projectionMatrix * viewMatrix * w; c.z = (vH / 400.) * 2. - 1.; gl_Position = c; }',
    fragmentShader: 'varying float vH; void main(){ gl_FragColor = vec4(vH, 1., 0., 1.); }' });
  const hidden = [], box = new THREE.Box3();
  S.traverse(o => { if (!o.visible) return;
    const flat = o.isMesh && !o.isInstancedMesh && (box.setFromObject(o), box.max.y < 0.6);
    if (o.name === 'SITE_GROUND' || o.name === 'SLEEK_SEA' || o.parent?.name === 'SLEEK_ROADS' || o.isPoints || o.isLine || o.isSprite || flat) { o.visible = false; hidden.push(o); } });
  const bg = S.background, fog = S.fog, cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha(), tm = R.toneMapping;
  const rt = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.FloatType, depthBuffer: true });
  const read = (k) => { mat.uniforms.uK.value.copy(k); R.setRenderTarget(rt); R.clear(); R.render(S, cam); const b = new Float32Array(RES * RES * 4); R.readRenderTargetPixels(rt, 0, 0, RES, RES, b); return b; };
  let sunBuf, aoBuf;
  try { S.background = null; S.fog = null; S.overrideMaterial = mat; R.toneMapping = THREE.NoToneMapping; R.setClearColor(0x000000, 0);
    sunBuf = read(new THREE.Vector2(SUN.x / SUN.y, SUN.z / SUN.y)); aoBuf = read(new THREE.Vector2(0, 0)); }
  finally { R.setRenderTarget(null); S.overrideMaterial = null; S.background = bg; S.fog = fog; R.toneMapping = tm; R.setClearColor(cc, ca); hidden.forEach(o => { o.visible = true; }); rt.dispose(); mat.dispose(); }

  const n = RES * RES, mask = new Float32Array(n), hgt = new Float32Array(n), foot = new Float32Array(n);
  for (let i = 0; i < n; i++) { const m = sunBuf[i * 4 + 1] > 0.5 ? 1 : 0; mask[i] = m; hgt[i] = m * sunBuf[i * 4]; foot[i] = aoBuf[i * 4 + 1] > 0.5 ? 1 : 0; }
  // 가로·세로로 나눠 하는 상자 흐림(두 번 하면 가우스에 가깝다)
  const boxBlur = (src, r) => { if (r < 0.5) return src; r = Math.round(r); const tmp = new Float32Array(n), out = new Float32Array(n), w = 2 * r + 1;
    for (let y = 0; y < RES; y++) { let acc = 0; const row = y * RES; for (let x = -r; x <= r; x++) acc += src[row + Math.min(RES - 1, Math.max(0, x))]; for (let x = 0; x < RES; x++) { tmp[row + x] = acc / w; acc += src[row + Math.min(RES - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
    for (let x = 0; x < RES; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(RES - 1, Math.max(0, y)) * RES + x]; for (let y = 0; y < RES; y++) { out[y * RES + x] = acc / w; acc += tmp[Math.min(RES - 1, y + r + 1) * RES + x] - tmp[Math.max(0, y - r) * RES + x]; } }
    return out; };
  const blur2 = (src, r) => boxBlur(boxBlur(src, r / 1.6), r / 1.6);
  const RADII = [0, 1, 2, 4, 7, 11], levels = RADII.map(r => blur2(mask, r));
  // 칸 주변(그림자 밖 반영 칸 포함)의 '가린 부분 높이' 평균
  const wide = blur2(mask, 12), hAvg = blur2(hgt, 12);
  const ao = blur2(foot, 2.5), shade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    if (wide[i] > 0.002) {
      const h = mask[i] ? hgt[i] : hAvg[i] / wide[i];        // 이 칸을 가린 높이(그림자 밖이면 주변 평균)
      const rp = (0.12 + h * 0.07) / PX;                      // 흐림 반경(칸): 높을수록(= 물체에서 멀수록) 넓게
      let k = 0; while (k < RADII.length - 2 && RADII[k + 1] < rp) k++;
      const t = Math.min(1, Math.max(0, (rp - RADII[k]) / (RADII[k + 1] - RADII[k])));
      const v = levels[k][i] * (1 - t) + levels[k + 1][i] * t;
      const dens = 0.6 * (1 - 0.55 * Math.min(1, h / 45));    // 진하기: 붙은 곳 0.6 → 멀리 0.27
      s = v * dens;
    }
    const a = ao[i] * 0.2;                                     // 접지 그림자
    shade[i] = 1 - (1 - s) * (1 - a);
  }
  // 읽은 픽셀 0행 = 화면 아래 = 남쪽 → 바닥 캔버스와 같은 방향
  const sc = document.createElement('canvas'); sc.width = sc.height = RES; const sx = sc.getContext('2d'), im = sx.createImageData(RES, RES);
  for (let i = 0; i < n; i++) { im.data[i * 4] = 0x2b; im.data[i * 4 + 1] = 0x35; im.data[i * 4 + 2] = 0x50; im.data[i * 4 + 3] = Math.round(Math.min(1, shade[i]) * 255); } // 그림자 색: 푸른 회색
  sx.putImageData(im, 0, 0);
  const c = baseTex.image, x = c.getContext('2d');
  // 곱하기: 투명한 곳은 그대로, 그림자 칸은 푸른 회색 쪽으로
  const m = document.createElement('canvas'); m.width = m.height = c.width; const mx = m.getContext('2d'); mx.fillStyle = '#fff'; mx.fillRect(0, 0, c.width, c.height); mx.drawImage(sc, 0, 0, c.width, c.height);
  x.save(); x.globalCompositeOperation = 'multiply'; x.drawImage(m, 0, 0); x.restore();
  baseTex.needsUpdate = true;
}

// 바닥 그림에서 바다 칸을 가린다: 빨강 값의 분포를 오츠 문턱값으로 둘로 나눈다. 바다=흰색 캔버스를 돌려준다
function seaMaskCanvas(img, N) {
  const mc = document.createElement('canvas'); mc.width = mc.height = N; const mx = mc.getContext('2d');
  mx.drawImage(img, 0, 0, N, N); const im = mx.getImageData(0, 0, N, N), d = im.data;
  const hist = new Array(256).fill(0), val = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) { const v = 255 - d[i * 4]; val[i] = v; hist[v]++; } // 빨강이 낮을수록 바다: 낮(바다 72·땅 160대)·밤(바다 10·땅 22~34) 모두 갈린다
  let sum = 0, sumB = 0, wB = 0, best = 0, th = 140; for (let i = 0; i < 256; i++) sum += i * hist[i];
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = N * N - wB; if (!wF) break; sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = i; } }
  for (let i = 0; i < N * N; i++) { const k = val[i] > th ? 255 : 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = k; d[i * 4 + 3] = 255; }
  mx.putImageData(im, 0, 0); return mc;
}

// ---- 바다: 실시간 반사 계산 없이 UV 스크롤로 ----
// 땅 바닥이 바다 칸을 도려내고(seaMaskCanvas), 그보다 살짝 낮게 바다 판 하나를 깐다.
// 물결 무늬 두 겹 + 반짝임 점 두 겹이 서로 다른 방향·속도로 흐르고, 두 반짝임이 겹치는 곳만 빛나 구운 햇빛 반짝임처럼 보인다.
// 비스듬히 볼수록 하늘색이 비친다(프레넬). 라이트 모드는 반짝임을 세게, 다크 모드는 달빛처럼 약하게.
function makeSea(el, ground) {
  if (!ground.material.alphaMap) return 'none'; // 땅이 바다 칸을 도려내지 못했으면 바다를 깔지 않는다
  const tile = (fn, size = 256) => { const t = document.createElement('canvas'); t.width = t.height = size; fn(t.getContext('2d'), size); const tx = new THREE.CanvasTexture(t); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx; };
  const rnd = (() => { let k = 7; return () => (k = (k * 16807) % 2147483647) / 2147483647; })();
  const wave = tile((x, S) => { x.fillStyle = '#808080'; x.fillRect(0, 0, S, S); x.filter = 'blur(10px)'; for (let i = 0; i < 260; i++) { const u = rnd() * S, v = rnd() * S, r = 6 + rnd() * 22; x.fillStyle = 'rgba(' + (rnd() > .5 ? 255 : 0) + ',' + (rnd() > .5 ? 255 : 0) + ',255,' + (0.15 + rnd() * 0.25).toFixed(2) + ')'; for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { x.beginPath(); x.ellipse(u + dx, v + dy, r * 1.8, r * 0.7, 0, 0, 7); x.fill(); } } });
  const glint = tile((x, S) => { x.fillStyle = '#000'; x.fillRect(0, 0, S, S); x.filter = 'blur(0.6px)'; for (let i = 0; i < 900; i++) { const u = rnd() * S, v = rnd() * S, r = 0.6 + rnd() * 1.6; x.fillStyle = 'rgba(255,255,255,' + (0.4 + rnd() * 0.6).toFixed(2) + ')'; x.beginPath(); x.ellipse(u, v, r * 2.2, r * 0.8, 0, 0, 7); x.fill(); } });

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uWave: { value: wave }, uGlint: { value: glint }, uTime: { value: 0 },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uSun: { value: -1 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: [
      'uniform sampler2D uWave, uGlint; uniform float uTime, uSun; uniform vec3 uDeep, uShallow, uSky; varying vec2 vUv; varying vec3 vW;',
      'void main(){',
      '  float t = uTime;',
      '  vec2 w1 = texture2D(uWave, vUv * 34. - vec2(t * .012, 0.)).rg, w2 = texture2D(uWave, vUv * 47. - vec2(t * .007, t * .0015)).rg;', // 왼쪽 → 오른쪽으로 흐른다
      '  float h = (w1.r + w2.g) * .5;',
      '  vec3 col = mix(uDeep, uShallow, smoothstep(.2, .9, h) * .7);',
      '  float f = pow(1. - clamp(normalize(cameraPosition - vW).y, 0., 1.), 3.);',
      '  col = mix(col, uSky, f * .55);',
      '  vec2 jit = (w1 - .5) * .004;',
      '  float g1 = texture2D(uGlint, vUv * 90. + jit - vec2(t * .018, 0.)).r, g2 = texture2D(uGlint, vUv * 70. - jit - vec2(t * .011, 0.)).r;',
      '  float glint = pow(g1 * g2, 1.6) * 2.4 * uSun * (.4 + f);',
      '  float edge = smoothstep(0., .12, vUv.x) * smoothstep(0., .12, 1. - vUv.x) * smoothstep(0., .12, vUv.y) * smoothstep(0., .12, 1. - vUv.y);', // 판 끝은 서서히 사라지게
      '  gl_FragColor = vec4(col + vec3(glint), edge);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>', // 다른 재질과 같은 색 변환(선형 → 화면 sRGB)
      '}'].join('\n'),
  });
  const gb = new THREE.Box3().setFromObject(ground), sz = gb.getSize(new THREE.Vector3()), cen = gb.getCenter(new THREE.Vector3());
  const geo = new THREE.PlaneGeometry(sz.x, sz.z); geo.rotateX(-Math.PI / 2);
  // 바닥 UV와 같게: u = (x - minX)/W, v = (maxZ - z)/D
  const P = geo.attributes.position, U = geo.attributes.uv; for (let i = 0; i < P.count; i++) U.setXY(i, (P.getX(i) + sz.x / 2) / sz.x, (sz.z / 2 - P.getZ(i)) / sz.z);
  const sea = new THREE.Mesh(geo, mat); sea.name = 'SLEEK_SEA'; sea.position.set(cen.x, gb.max.y - 0.5, cen.z); // 땅보다 낮게: 해안선으로 도려낸 구멍으로만 보인다 sea.renderOrder = 2; sea.raycast = () => {};
  ground.parent.add(sea); // 바닥과 같은 묶음 → 낮·밤 배경이 바뀌면 함께 숨는다
  const t0 = performance.now(); let last = 0;
  (function flow(now) { // 30fps면 충분: 바다가 보일 때만 시간을 흘리고 다시 그린다
    if (now - last > 33 && isShown(sea) && !document.hidden) { last = now; mat.uniforms.uTime.value = (now - t0) / 1000; el._dirty = true; }
    requestAnimationFrame(flow);
  })(t0);
  return {
    setTheme(dark) {
      const V = mat.uniforms, sun = dark ? 0.55 : 1; if (V.uSun.value === sun) return;
      V.uDeep.value.set(dark ? 0x1b3550 : 0x5d9fc2); V.uShallow.value.set(dark ? 0x23415f : 0x78b5d3); V.uSky.value.set(dark ? 0x3a5672 : 0xdcedf6); V.uSun.value = sun; // 밤바다도 땅과 구분되게 살짝 밝게
    },
  };
}

// 가로등 빛을 바닥에 굽는다: 반투명 원 대신, 가로등마다 점광원 하나가 바닥을 비춘 모양(거리 제곱에 반비례해 어두워짐)을
// 캔버스 라이트맵에 그려 둔다. 실시간 빛·반사 없이 바닥 색에 곱해져 자연스럽고 가볍다.
function bakeLampLight(ground, pool) {
  const N = 2048, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
  const gb = new THREE.Box3().setFromObject(ground), W = gb.max.x - gb.min.x, D = gb.max.z - gb.min.z; // 바닥 판은 회전돼 있어 월드 좌표로 잰다
  const M = new THREE.Matrix4(), p = new THREE.Vector3(), H = 7, R = 16; // 등 높이 7m, 빛이 닿는 반경 16m
  x.globalCompositeOperation = 'lighter'; // 가까운 가로등끼리 빛이 더해진다
  for (let i = 0; i < pool.count; i++) {
    pool.getMatrixAt(i, M); p.setFromMatrixPosition(M).applyMatrix4(pool.matrixWorld);
    // 바닥 UV: u = (x - minX)/W, v = (maxZ - z)/D → 캔버스(flipY) 세로는 (z - minZ)/D
    const cx = (p.x - gb.min.x) / W * N, cy = (p.z - gb.min.z) / D * N, r = R / W * N;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (let k = 0; k <= 8; k++) { const d = k / 8 * R, e = (H * H) / (H * H + d * d), f = e * e * (1 - k / 8); g.addColorStop(k / 8, `rgba(255,${Math.round(150 + 40 * f)},${Math.round(80 + 40 * f)},${f.toFixed(3)})`); }
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  const lm = new THREE.CanvasTexture(c); lm.channel = 0; lm.colorSpace = THREE.SRGBColorSpace; // 바닥은 uv가 하나뿐이라 0번 채널을 쓴다
  ground.material.lightMap = lm; ground.material.lightMapIntensity = 12; ground.material.needsUpdate = true; // 바닥이 어두운 색이라 세게 줘야 보인다
}

// ---- 4) 공정을 볼 때(소개 중 포함) 카메라와 공정 사이를 가리는 주변 모델 숨기기 ----
// 대상 공정: 소개 중이면 그 공정(el.__sleekFocus), 아니면 들어가 있는 공정. 대상이 바뀌면 숨긴 것을 되돌리고 다시 잰다.
const hidden = new Set();
const ray = new THREE.Raycaster();
let hiddenFor = null;
function hideOccluders(el) {
  const z = el.__sleekFocus ? el.zones[el.__sleekFocus] : (!el._isOverview && el.zone);
  const fid = el.__sleekFocus || (z ? 'in:' + (el.process?.id || '') : null);
  if (fid !== hiddenFor || !z || !z.root.visible) { if (hidden.size) { hidden.forEach(o => { o.visible = true; }); hidden.clear(); el._dirty = true; } hiddenFor = fid; }
  if (!z || !z.root.visible) return;
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'); if (!ext) return;
  const box = new THREE.Box3().setFromObject(z.root); if (box.isEmpty()) return;
  const cam = el.camera.position, s = box.getSize(new THREE.Vector3()), pts = [];
  for (const fx of [.1, .37, .63, .9]) for (const fz of [.15, .5, .85]) for (const fy of [.15, .5])
    pts.push(new THREE.Vector3(box.min.x + s.x * fx, box.min.y + s.y * fy, box.min.z + s.z * fz));
  // 주변 건물 GLB는 site-backdrop.js가 메시 레이캐스트를 꺼 두어(클릭 통과), 각 메시의 경계 상자와 광선으로 판정한다
  if (!ext.userData.boxes) { const B = []; ext.updateMatrixWorld(true); ext.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.name === 'SITE_GROUND' || o.userData.lamp) return; const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3()); if (Math.max(sz.x, sz.z) > 150) return; B.push([o, b]); }); ext.userData.boxes = B; } // 바닥처럼 넓은 판은 빼 둔다
  const hit = new THREE.Vector3();
  pts.forEach(p => {
    const dir = p.clone().sub(cam), len = dir.length(); ray.set(cam, dir.normalize());
    ext.userData.boxes.forEach(([o, b]) => { if (hidden.has(o) || b.containsPoint(p)) return; if (ray.ray.intersectBox(b, hit) && hit.distanceTo(cam) < len) { o.visible = false; hidden.add(o); el._dirty = true; } });
  });
}

// ---- 2) 인트로: 어두운 화면에서 조명이 서서히 켜지며 드론 시점으로 다가간다 ----
function playIntro(el, showcase) {
  const R = el.renderer, exposure = R.toneMappingExposure;
  // 이름표는 장면이 매 프레임 개별 스타일을 만지므로 감싸는 겹(el.labels)째로 숨긴다
  // 주의: 이 겹은 3D 화면 전체를 덮는다. 원래 pointer-events:none(마우스 통과)이라, 그 값은 건드리지 않는다(지웠더니 드래그 회전이 막혔다)
  const labels = (op) => { el.labels.style.transition = 'opacity .8s ease'; el.labels.style.opacity = op; };
  labels(0);
  R.toneMappingExposure = 0;
  el._dirty = true; setTimeout(() => document.body.classList.add('sleek-ready'), 80); // 노출 0(검은 화면)으로 한 번 그린 뒤 덮개를 걷는다

  // 카메라: 조금 더 높고 먼 곳에서 드론 시점으로 천천히 다가간다
  const to = el._overviewPose();
  Object.assign(el.orbit, { yaw: to.yaw - 0.25, pitch: to.pitch + 0.12, dist: to.dist * 1.35 }); el.orbit.target.copy(to.target);
  el._animateTo?.(to);
  setTimeout(() => el._animateTo?.(to), 50);

  const t0 = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / LIGHT_MS);
    R.toneMappingExposure = exposure * (k * k * (3 - 2 * k));
    el._dirty = true;
    if (k < 1) return requestAnimationFrame(tick);
    labels(1);
    tidyScene(el);
    showcase.begin();
    document.dispatchEvent(new CustomEvent('sleek-intro-done'));
  };
  requestAnimationFrame(tick);
}

// 공정 소개: 몇 초마다 01 제선 → 02 제강 → 03 연주 → 04 열간압연 순서로 카메라가 다가가 동그라미 콜아웃으로 가리키고, 페이지에 'sleek-showcase' {id}를 알린다.
// 페이지 카드의 '이 공정 보기'로 들어가면 멈추고, 전체 공정으로 돌아오면 다시 돈다. '다음 공정'은 'sleek-showcase-next'.
const SHOW_MS = 6000;
const SHOW_FOV = 20; // 소개할 때 화각(기본 42). 작을수록 더 당겨 보인다
// 홈(전체 공정) 화면의 화각: 기본 화면은 34°(공장이 화면에 차게), 휠로 12°까지 당긴다. 34°보다 넓어지지(멀어지지) 않는다.
// 원래 장면은 거리 120 이하를 '공정 안'으로 보아 휠 줌이 125~300으로 묶여 있었다 → 홈에선 거리 대신 화각으로 줌한다
const HOME_FOV = 34, HOME_FOV_MIN = 12;
function startShowcase(el) {
  let cur = null, timer = 0, running = false;
  const inSite = () => (el.getAttribute('process') || 'site') === 'site';
  // 줌인은 거리 대신 화각으로 한다: 거리를 120 아래로 줄이면 장면이 '공정 안' 상태로 바뀌어 이름표·조작이 달라진다
  const BASE_FOV = el.camera.fov; let fovTo = BASE_FOV;
  (function lens() { const c = el.camera, d = fovTo - c.fov;
    if (Math.abs(d) > 0.05) { c.fov += d * 0.05; c.updateProjectionMatrix(); el._dirty = true; } else if (d) { c.fov = fovTo; c.updateProjectionMatrix(); el._dirty = true; }
    requestAnimationFrame(lens); })();
  // 공정마다 동그라미 콜아웃 하나. 소개 중엔 그 공정 것만, 자유 시점(직접 둘러보기)에선 넷 다 띄운다
  const callouts = Object.fromEntries(IDS.map(k => [k, makeCallout(el)]));
  let labelsOn = true; // '공정 이름표 숨김' 버튼
  const showOnly = (id) => IDS.forEach(k => { if (k === id && labelsOn) callouts[k].show(k, 900); else callouts[k].hide(); });
  // 홈(자유 시점)에선 늘 띄워 두지 않는다: 시야를 가리고 돌릴 때마다 따라다녀 어지럽다.
  // 마우스가 공정 가까이 가면 그 공정 것만 띄우고(hoverId), 드래그·휠로 돌리는 동안엔 모두 숨긴다
  let hoverId = null;
  const setHover = (id) => { if (id === hoverId) return; if (hoverId) callouts[hoverId].hide(); hoverId = id; if (id && labelsOn) callouts[id].show(id, 0); };
  const showAll = () => setHover(null); // 자유 시점으로 들어갈 때: 처음엔 아무것도 띄우지 않는다
  const zoneBoxes = () => IDS.map(k => [k, new THREE.Box3().setFromObject(el.zones[k].root)]);
  const v3 = new THREE.Vector3();
  document.addEventListener('pointermove', (e) => {
    if (!free || running || !inSite() || el._2d || !labelsOn) return;
    if (e.buttons) { setHover(null); return; } // 돌리는 중
    if (e.target.closest?.('button')) return; // 동그라미 위에 올라가 있으면 유지
    const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (mx < 0 || my < 0 || mx > r.width || my > r.height) { setHover(null); return; }
    let best = null, bestD = Infinity;
    zoneBoxes().forEach(([k, b]) => { // 화면에 비친 공정 영역(상자 8꼭짓점) 안이거나 60px 이내면 후보, 그중 중심이 가장 가까운 것
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const X of [b.min.x, b.max.x]) for (const Y of [b.min.y, b.max.y]) for (const Z of [b.min.z, b.max.z]) { v3.set(X, Y, Z).project(el.camera); const px = (v3.x + 1) / 2 * r.width, py = (1 - v3.y) / 2 * r.height; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
      const dx = Math.max(x0 - mx, 0, mx - x1), dy = Math.max(y0 - my, 0, my - y1), out = Math.hypot(dx, dy);
      const d = Math.hypot(mx - (x0 + x1) / 2, my - (y0 + y1) / 2);
      if (out < 60 && d < bestD) { bestD = d; best = k; }
    });
    setHover(best);
  });
  const hideAll = () => { IDS.forEach(k => callouts[k].hide()); hoverId = null; };
  const setLabels = el.setZoneLabelsVisible?.bind(el);
  el.setZoneLabelsVisible = function (v) { setLabels?.(v); labelsOn = !!v; if (!inSite()) return; if (running) showOnly(cur); else if (free) showAll(); };
  const show = (id) => {
    cur = id; fovTo = SHOW_FOV; el.__sleekFocus = id;
    showOnly(id);
    const z = el.zones[id], box = new THREE.Box3().setFromObject(z.root), c = box.getCenter(new THREE.Vector3());
    // 거리 130: 장면이 '전체 공정'으로 여기는 범위(120 초과)를 지켜 이름표·휠 동작이 그대로다
    // 공정을 화면 가로 64% 쯤에 둔다: 시선 중심을 카메라 기준 왼쪽으로 옮기면 공정이 오른쪽으로 간다
    const YAW = -0.55, DIST = 130, viewW = 2 * DIST * Math.tan(SHOW_FOV * Math.PI / 360) * (el.camera.aspect || 1.6);
    const right = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW)), tgt = new THREE.Vector3(c.x, 0, c.z).addScaledVector(right, -viewW * 0.14);
    el._animateTo({ yaw: YAW, pitch: 0.4, dist: DIST, target: tgt });
    document.dispatchEvent(new CustomEvent('sleek-showcase', { detail: { id } }));
  };
  const next = () => { show(IDS[(IDS.indexOf(cur) + 1) % IDS.length]); schedule(SHOW_MS); }; // 처음(cur=null)이면 01부터
  const schedule = (ms) => { clearTimeout(timer); if (running) timer = setTimeout(next, ms); };
  const start = (delay) => { running = true; schedule(delay); };
  const stop = () => { running = false; clearTimeout(timer); hideAll(); fovTo = inSite() ? HOME_FOV : BASE_FOV; el.__sleekFocus = null; };
  // 드래그·휠·홈 버튼으로 직접 둘러보기 시작하면 소개를 끝내고(카드·동그라미도 닫음) 원래 화각의 자유 시점으로 돌려준다
  let free = false;
  const goFree = () => { if (free) return; free = true; stop(); fovTo = HOME_FOV; el.camera.fov = HOME_FOV; el.camera.updateProjectionMatrix(); el._dirty = true; showAll(); document.dispatchEvent(new CustomEvent('sleek-showcase', { detail: { id: null } })); };
  const overview = el.overview.bind(el);
  el.overview = function (...a) { if (running) goFree(); fovTo = HOME_FOV; return overview(...a); }; // 홈 버튼(goSite)이 부른다: 기본 홈 화면으로
  document.addEventListener('sleek-showcase-next', () => { if (running) next(); });
  // 공정에 들어가는 길은 여러 개(카드 버튼·이름표·왼쪽 메뉴)라, 장면의 process 속성을 직접 지켜본다
  new MutationObserver(() => { if (!inSite()) { stop(); fovTo = BASE_FOV; return; } if (free) { fovTo = HOME_FOV; showAll(); } else if (!running) start(2500); }).observe(el, { attributes: true, attributeFilter: ['process'] });
  // 드래그·휠을 시작하면: 소개 중이면 끝내고, 진행 중인 카메라 이동(_animateTo)은 끊어서 손으로 돌리는 것이 바로 먹게 한다
  let started = false; // 인트로가 끝나 소개를 시작했는지
  const takeOver = () => { if (!started) free = true; /* 인트로 중 직접 만지면 소개 없이 자유 시점으로 */ if (running) goFree(); if (inSite()) { el.anim = null; if (free) setHover(null); } };
  el.addEventListener('pointerdown', takeOver, { capture: true });
  el.addEventListener('wheel', (e) => {
    takeOver();
    if (!inSite() || el._2d || el.orbit.dist <= 120) return; // 공정 안·2D 보기는 장면의 원래 줌
    e.stopImmediatePropagation(); e.preventDefault();
    fovTo = Math.max(HOME_FOV_MIN, Math.min(HOME_FOV, fovTo * (1 + e.deltaY * 0.0012)));
  }, { capture: true, passive: false });
  return { begin() { started = true; if (!inSite()) return; if (free) { fovTo = HOME_FOV; showAll(); } else start(0); } };
}

// 동그라미 콜아웃(레퍼런스: 자동차 부품 지시선): 흰 원 안에 '01 / 제선', 원에서 가로로 나온 선이 꺾여 3D 공정을 가리킨다.
// 선 끝은 공정 모델 위 한 점을 매 프레임 화면 좌표로 옮겨 붙인다. 원을 누르면 그 공정으로 들어간다.
function makeCallout(el) {
  const host = el.parentElement; // 3D 영역(x-import) 안에 겹친다
  const D = 96, R = D / 2; // 원 지름
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity .5s ease;';
  wrap.innerHTML = `
    <svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">
      <path pathLength="1" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.5" stroke-dasharray="1" stroke-dashoffset="1" style="transition:stroke-dashoffset .9s cubic-bezier(.6,0,.2,1)"/>
      <circle r="3.5" fill="#fff" style="opacity:0;transition:opacity .3s ease .8s"/>
    </svg>
    <button style="position:absolute;left:0;top:0;width:${D}px;height:${D}px;margin:-${D / 2}px 0 0 -${D / 2}px;border:none;border-radius:50%;
      cursor:pointer;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
      box-shadow:0 10px 30px rgba(0,0,0,.35);transform:scale(.6);opacity:0;transition:transform .5s cubic-bezier(.2,.8,.2,1), opacity .4s ease;">
      <span data-num style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.18em;opacity:.65"></span>
      <span data-name style="font-family:'Noto Sans KR',sans-serif;font-size:19px;font-weight:900;letter-spacing:-0.02em"></span>
    </button>`;
  host.appendChild(wrap);
  const path = wrap.querySelector('path'), dot = wrap.querySelector('circle'), btn = wrap.querySelector('button');
  let id = null, anchor = null, corners = [], t;
  btn.addEventListener('click', () => { if (id) document.dispatchEvent(new CustomEvent('steel-goto', { detail: { process: id } })); });
  const v = new THREE.Vector3();
  (function follow() {
    if (id && anchor) {
      const W = el.clientWidth, H = el.clientHeight;
      v.copy(anchor).project(el.camera);
      const ax = (v.x + 1) / 2 * W, ay = (1 - v.y) / 2 * H;
      // 원은 화면에 비친 공정 영역의 왼쪽 위 모서리 근처(공정에 붙어 보이게). 화면 밖으로 나가지 않게 붙잡는다
      let x0 = Infinity, y0 = Infinity;
      corners.forEach(k => { v.copy(k).project(el.camera); x0 = Math.min(x0, (v.x + 1) / 2 * W); y0 = Math.min(y0, (1 - v.y) / 2 * H); });
      const cx = Math.max(R + 16, Math.min(W - R - 16, Math.min(ax - 120, x0 + 40))), cy = Math.max(R + 80, Math.min(H - R - 16, Math.min(ay - 60, y0 - R * 0.3)));
      btn.style.left = cx + 'px'; btn.style.top = cy + 'px';
      const sx = cx + R, ex = Math.min(ax - 30, sx + 50); // 원 오른쪽에서 짧게 가로로 나와, 꺾여서 점으로
      path.setAttribute('d', `M${sx},${cy} L${Math.max(sx, ex)},${cy} L${ax},${ay}`);
      dot.setAttribute('cx', ax); dot.setAttribute('cy', ay);
    }
    requestAnimationFrame(follow);
  })();
  // 다크 모드: 검은 원, 위는 불투명 → 아래로 살짝 반투명. 라이트 모드: 밝은 원
  let painted = null;
  const paint = () => { const dark = (el.getAttribute('theme') || 'dark') === 'dark'; if (painted === dark) return; painted = dark;
    Object.assign(btn.style, dark
      ? { background: 'linear-gradient(180deg, rgba(10,11,13,1) 0%, rgba(10,11,13,.94) 45%, rgba(10,11,13,.62) 100%)', color: '#f4f6f9', boxShadow: '0 10px 30px rgba(0,0,0,.45)' }
      : { background: 'rgba(244,246,249,.92)', color: '#111', boxShadow: '0 10px 30px rgba(0,0,0,.25)' }); };
  new MutationObserver(paint).observe(el, { attributes: true, attributeFilter: ['theme'] });
  const reset = () => { path.style.transition = 'none'; path.setAttribute('stroke-dashoffset', '1'); dot.style.opacity = '0'; btn.style.transform = 'scale(.6)'; btn.style.opacity = '0'; };
  return {
    show(next, delay = 900) {
      const p = PROCESSES.find(q => q.id === next), z = el.zones[next];
      if (!p || !z) return;
      clearTimeout(t); reset();
      id = next;
      const box = new THREE.Box3().setFromObject(z.root), c = box.getCenter(new THREE.Vector3());
      anchor = new THREE.Vector3(c.x, box.min.y + (box.max.y - box.min.y) * 0.45, c.z); // 공정 모델 가운데쯤
      corners = [0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k => new THREE.Vector3(i ? box.max.x : box.min.x, j ? box.max.y : box.min.y, k ? box.max.z : box.min.z))));
      btn.querySelector('[data-num]').textContent = p.num;
      btn.querySelector('[data-name]').textContent = p.name;
      paint();
      wrap.style.opacity = '1';
      // 카메라가 다가간 뒤: 원이 나타나고 → 선이 그려진다
      t = setTimeout(() => {
        btn.style.transform = 'scale(1)'; btn.style.opacity = '1';
        t = setTimeout(() => { path.style.transition = 'stroke-dashoffset .9s cubic-bezier(.6,0,.2,1)'; path.setAttribute('stroke-dashoffset', '0'); dot.style.opacity = '1'; }, 350);
      }, delay);
    },
    hide() { clearTimeout(t); id = null; wrap.style.opacity = '0'; reset(); },
  };
}
