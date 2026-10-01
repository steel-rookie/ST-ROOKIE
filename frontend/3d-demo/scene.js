// <steel-scene> — Three.js 공정 뷰. 설비 그룹 이름 = EQ_<id> (GLB 노드 규약과 동일).
// GLB 교체: buildProcess() 안의 primitive 생성 부분을 GLTFLoader.load(`models/${processId}.glb`)로 바꾸고,
// scene.getObjectByName(`EQ_${id}`)로 노드를 찾으면 나머지(라벨·클릭·하이라이트·흐름)는 그대로 동작.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { findProcess } from './data.js';

const STEEL = 0x7d8794, DARK = 0x4a525c, ACCENT = 0xff7a1a;
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.35, ...o });
const mesh = (g, m, y = 0) => { const o = new THREE.Mesh(g, m); o.position.y = y; return o; };

function equipmentPrimitive(shape) {
  const g = new THREE.Group();
  const add = (m) => (g.add(m), m);
  switch (shape) {
    case 'tower': add(mesh(new THREE.CylinderGeometry(1.3, 1.9, 6.5, 20), mat(STEEL), 3.25)); add(mesh(new THREE.CylinderGeometry(0.6, 1.3, 1.6, 20), mat(DARK), 7.3)); add(mesh(new THREE.CylinderGeometry(0.9, 1.9, 1.2, 20), mat(DARK), 0.6)); break;
    case 'battery': for (let i = 0; i < 5; i++) add(mesh(new THREE.BoxGeometry(0.7, 3, 2.4), mat(i % 2 ? DARK : STEEL), 1.5)).position.x = (i - 2) * 0.85; break;
    case 'cyl': for (let i = 0; i < 3; i++) add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 4.5, 16), mat(STEEL), 2.25)).position.x = (i - 1) * 1.7; break;
    case 'ladle': add(mesh(new THREE.CylinderGeometry(1.3, 1.0, 2.6, 20), mat(STEEL), 1.3)); add(mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.2, 20), mat(ACCENT, { emissive: ACCENT, emissiveIntensity: 0.6 }), 2.65)); break;
    case 'converter': add(mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 20), mat(STEEL), 1.9)); add(mesh(new THREE.CylinderGeometry(0.7, 1.5, 1.4, 20), mat(DARK), 4.1)); add(mesh(new THREE.CylinderGeometry(1.5, 1.0, 0.9, 20), mat(DARK), 0.45)); add(mesh(new THREE.BoxGeometry(4, 0.3, 0.3), mat(DARK), 1.9)); break;
    case 'twin': add(mesh(new THREE.CylinderGeometry(1.1, 0.9, 2.4, 20), mat(STEEL), 1.2)).position.x = -1.3; add(mesh(new THREE.BoxGeometry(1.8, 3.6, 1.8), mat(DARK), 1.8)).position.x = 1.3; break;
    case 'tray': add(mesh(new THREE.BoxGeometry(4, 1.2, 1.8), mat(STEEL), 3.2)); add(mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), mat(DARK), 1.3)).position.x = -1.7; add(mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), mat(DARK), 1.3)).position.x = 1.7; break;
    case 'mold': add(mesh(new THREE.BoxGeometry(2.6, 2.2, 2.2), mat(0xb87333, { metalness: 0.6 }), 2.6)); add(mesh(new THREE.BoxGeometry(3.2, 0.4, 2.8), mat(DARK), 1.3)); break;
    case 'rollers': for (let i = 0; i < 6; i++) { const r = add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 12), mat(DARK), 0.9)); r.rotation.x = Math.PI / 2; r.position.x = (i - 2.5) * 0.8; } add(mesh(new THREE.BoxGeometry(5, 0.2, 0.2), mat(STEEL), 2.6)); break;
    case 'gate': add(mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), mat(STEEL), 1.6)).position.z = -1.4; add(mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), mat(STEEL), 1.6)).position.z = 1.4; add(mesh(new THREE.BoxGeometry(0.5, 0.5, 3.2), mat(DARK), 3.2)); add(mesh(new THREE.ConeGeometry(0.25, 0.7, 12), mat(ACCENT, { emissive: ACCENT, emissiveIntensity: 0.8 }), 2.6)).rotation.x = Math.PI; break;
    case 'stand': add(mesh(new THREE.BoxGeometry(2.2, 4, 3), mat(STEEL), 2)); add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 3.2, 16), mat(DARK), 1.0)).rotation.x = Math.PI / 2; add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 3.2, 16), mat(DARK), 2.4)).rotation.x = Math.PI / 2; break;
    case 'stands': for (let i = 0; i < 4; i++) add(mesh(new THREE.BoxGeometry(1.0, 3.4, 2.8), mat(i % 2 ? DARK : STEEL), 1.7)).position.x = (i - 1.5) * 1.3; break;
    case 'table': add(mesh(new THREE.BoxGeometry(6, 0.3, 2.2), mat(DARK), 0.9)); for (let i = 0; i < 4; i++) add(mesh(new THREE.BoxGeometry(0.2, 1.6, 2.4), mat(STEEL), 1.9)).position.x = (i - 1.5) * 1.6; break;
    case 'coiler': add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.8, 24), mat(STEEL), 1.6)).rotation.x = Math.PI / 2; add(mesh(new THREE.BoxGeometry(1.2, 1.6, 1.2), mat(DARK), 0.8)); break;
    default: add(mesh(new THREE.BoxGeometry(3.2, 2.6, 2.6), mat(STEEL), 1.3)); add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 12), mat(DARK), 3.5)).position.x = 1;
  }
  return g;
}

function materialMesh(state) {
  const c = new THREE.Color(state.color);
  const glow = ['liquid'].includes(state.shape) || c.r > 0.9;
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, emissive: glow ? c : 0x000000, emissiveIntensity: glow ? 0.7 : 0 });
  const g = new THREE.Group();
  switch (state.shape) {
    case 'chunks': for (let i = 0; i < 6; i++) { const d = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + (i % 3) * 0.08, 0), m); d.position.set((i % 3 - 1) * 0.55, 0.3 + Math.floor(i / 3) * 0.45, (i % 2 - 0.5) * 0.5); g.add(d); } break;
    case 'liquid': { const s = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 16), m); s.scale.y = 0.6; s.position.y = 0.5; g.add(s); break; }
    case 'slab': g.add(mesh(new THREE.BoxGeometry(3.2, 0.5, 1.5), m, 0.45)); break;
    case 'bar': g.add(mesh(new THREE.BoxGeometry(4.5, 0.22, 1.4), m, 0.4)); break;
    case 'strip': g.add(mesh(new THREE.BoxGeometry(6, 0.08, 1.4), m, 0.4)); break;
    case 'coil': { const t = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.42, 14, 32), m); t.position.y = 1.15; g.add(t); break; }
  }
  return g;
}

class SteelScene extends HTMLElement {
  static get observedAttributes() { return ['process', 'selected', 'theme']; }
  connectedCallback() {
    if (this._init) { this._startLoop(); return; } this._init = true;
    Object.assign(this.style, { display: 'block', position: 'relative', overflow: 'hidden', width: '100%', height: '100%', touchAction: 'none' });
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%', cursor: 'grab' });
    this.appendChild(this.renderer.domElement);
    this.labels = document.createElement('div');
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    this.appendChild(this.labels);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
    this.orbit = { yaw: -0.5, pitch: 0.36, dist: 48, target: new THREE.Vector3(0, 1.5, 0) };
    this.home0 = { yaw: -0.5, pitch: 0.36, dist: 48, target: [0, 1.5, 0] }; this.home = { ...this.home0 };
    this.scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x3a4048, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(10, 20, 12); this.scene.add(sun);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.1 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.02; this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(240, 120, 0x556070, 0x3c4550); this.grid.visible = false; this.scene.add(this.grid);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.8, 48), new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    const sg = new THREE.BufferGeometry(), sp = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) { const r = 90 + Math.random() * 60, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9); sp.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) - 10, r * Math.sin(ph) * Math.sin(th)], i * 3); }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fb0c4, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.8 })); this.scene.add(this.stars);
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.set(0, 0.03, 0); this.scene.add(this.glow);
    this.skyline = new THREE.Group();
    for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 40, h = 4 + Math.random() * 22, w = 3 + Math.random() * 10; const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshBasicMaterial({ color: 0x0b1119 })); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); this.skyline.add(b); if (Math.random() < 0.3) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, h * 1.6, 8), b.material); s.position.set(b.position.x + w / 2, h * 0.8, b.position.z); this.skyline.add(s); } }
    this.scene.add(this.skyline);
    const pl = new THREE.PointLight(0xff7a1a, 1.6, 40, 1.5); pl.position.set(0, 3, 4); this.scene.add(pl);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.02; this.ring.visible = false; this.scene.add(this.ring);
    this.ray = new THREE.Raycaster(); this.eqs = []; this._tourId = 0; this._tourWaits = [];
    this._bindPointer();
    new ResizeObserver(() => this._resize()).observe(this);
    this._resize();
    this._applyTheme();
    this._buildProcess();
    this._applySelection();
    this._startLoop();
  }
  _startLoop() {
    if (this._raf) return;
    const tick = (now) => { this._frame(now); this.renderer.render(this.scene, this.camera); this._raf = requestAnimationFrame(tick); };
    this._raf = requestAnimationFrame(tick);
  }
  disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = 0; }
  attributeChangedCallback(n) {
    if (!this._init) return;
    if (n === 'process') this._buildProcess(); if (n === 'selected') this._applySelection(); if (n === 'theme') this._applyTheme();
  }
  _resize() { const w = this.clientWidth || 1, h = this.clientHeight || 1; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  _applyTheme() {
    const dark = (this.getAttribute('theme') || 'dark') === 'dark';
    this.scene.background = this._gradientTex(dark ? ['#05080d', '#0f1722', '#1c2733'] : ['#b9c4d0', '#d7dee6', '#eef1f4']);
    this.scene.fog = new THREE.FogExp2(dark ? 0x0d141c : 0xd3dae2, 0.006);
    if (this.stars) this.stars.visible = dark;
    this.ground.material.map = this._radialTex(dark ? ['#243040', '#141b24', '#0a0e14'] : ['#e2e7ec', '#c9d0d8', '#b5bdc6']); this.ground.material.color.set(0xffffff); this.ground.material.needsUpdate = true;
    this.grid.material.color.set(dark ? 0x33404f : 0xa2acb7); this.grid.material.transparent = true; this.grid.material.opacity = 0.6;
    if (this.glow) this.glow.material.color.set(dark ? 0xff6a10 : 0xffb070);
    if (this.skyline) this.skyline.traverse(o => { if (o.isMesh) o.material.color.set(dark ? 0x0b1119 : 0x9aa5b1); });
    this.dark = dark; this._styleLabels();
  }
  _styleLabels() {
    const id = this.getAttribute('selected');
    this.eqs.forEach(e => { const on = e.id === id; Object.assign(e.label.style, { color: on ? '#ff9a4a' : (this.dark ? '#dfe5ec' : '#1f262e'), opacity: on || !id ? '1' : '0.55', fontWeight: on ? '700' : '500' }); e.label.querySelector('i').style.background = on ? '#ff7a1a' : (this.dark ? '#dfe5ec' : '#1f262e'); });
  }
  _gradientTex(stops) { const c = document.createElement('canvas'); c.width = 4; c.height = 512; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); g.fillStyle = gr; g.fillRect(0, 0, 4, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  _radialTex(stops) { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), gr = g.createRadialGradient(256, 256, 20, 256, 256, 256); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); g.fillStyle = gr; g.fillRect(0, 0, 512, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  _buildProcess() {
    const p = findProcess(this.getAttribute('process')) ; if (!p) return;
    this.process = p;
    if (this.root) this.scene.remove(this.root);
    if (this.touring) { this._tourId++; this._skip(); this.move = null; this.touring = false; this.tourStep = null; }
    this.labels.innerHTML = ''; this.eqs = []; this._showInterior(null);
    this.root = new THREE.Group(); this.root.name = `PROCESS_${p.id}`;
    const n = p.equipment.length;
    p.equipment.forEach((e, i) => {
      const x = n === 1 ? 0 : -15 + 30 * i / (n - 1);
      const g = equipmentPrimitive(e.shape); g.name = `EQ_${e.id}`; g.position.x = x; g.userData.id = e.id;
      g.traverse(o => { if (o.isMesh) { o.userData.eq = e.id; o.userData.base = o.material.emissive.getHex(); } });
      this.root.add(g);
      const box = new THREE.Box3().setFromObject(g);
      const lab = document.createElement('div');
      lab.innerHTML = `<i></i><b>${e.name}</b>`;
      Object.assign(lab.style, { position: 'absolute', transform: 'translate(-7px,-50%)', display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', fontFamily: '"IBM Plex Sans KR", sans-serif', fontSize: '13px', fontWeight: '500', letterSpacing: '0.02em', lineHeight: '1', whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'pointer', textShadow: '0 1px 6px rgba(0,0,0,.8)', transition: 'opacity .2s' });
      lab.querySelector('i').style.cssText = 'width:8px;height:8px;border-radius:4px;flex:none;box-shadow:0 0 0 3px rgba(255,255,255,.15)';
      lab.onmouseenter = () => { lab.style.opacity = '1'; }; lab.onmouseleave = () => { this._styleLabels(); if (this.dimmed) this.eqs.forEach(q => { if (q.id !== this.getAttribute('selected')) q.label.style.opacity = '0.2'; }); };
      lab.onclick = () => this._select(e.id);
      this.labels.appendChild(lab);
      const sz = box.getSize(new THREE.Vector3());
      this.eqs.push({ id: e.id, x, data: e, anchor: new THREE.Vector3(x, box.max.y + 0.6, 0), focus: new THREE.Vector3(x, 2.5, 0), dist: 16, group: g, label: lab, interior: e.interior ? { cx: x, cz: 0, y0: box.min.y + 0.3, y1: box.max.y - 0.4, r: sz.x * 0.34 } : null });
    });
    this.scene.add(this.root);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-18, 0.05, 3.2), new THREE.Vector3(18, 0.05, 3.2)]);
    this.root.add(new THREE.Line(lg, new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.5 })));
    this.root.children[this.root.children.length - 1].computeLineDistances();
    this.path = [new THREE.Vector3(-18, 0, 3.2), ...this.eqs.map(e => new THREE.Vector3(e.x, 0, 3.2)), new THREE.Vector3(18, 0, 3.2)];
    this.states = [p.materialIn, ...p.equipment.map(e => e.materialOut)];
    this.stop(); this._setMaterial(0, this.path[0]); this._emitProgress();
    this.anchorMode = false; this.home = { ...this.home0 }; this.ring.scale.setScalar(1);
    this._applySelection();
    this._loadGLB(p);
  }
  // models/<processId>.glb 가 있으면 기본 도형을 GLB 노드(EQ_<id>)로 교체
  async _loadGLB(p) {
    const url = new URL(`models/${p.id}.glb`, document.baseURI).href;
    this._emitModel('loading', url);
    let cfg = null;
    try { const all = await (await fetch(new URL('models/anchors.json', document.baseURI))).json(); cfg = all[p.id] || null; } catch (e) {}
    new GLTFLoader().load(url, (gltf) => {
      if (this.process !== p) return;
      const model = gltf.scene; model.name = `GLB_${p.id}`;
      const sc = cfg?.scale ?? 1, off = new THREE.Vector3().fromArray(cfg?.offset || [0, 0, 0]);
      model.scale.setScalar(sc); model.position.copy(off);
      model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.userData.base = o.material.emissive ? o.material.emissive.getHex() : 0; } });
      const M = (a) => new THREE.Vector3().fromArray(a).multiplyScalar(sc).add(off);
      let mapped = 0;
      this.eqs.forEach(e => {
        const node = model.getObjectByName(`EQ_${e.id}`), a = cfg?.anchors?.[e.id];
        if (node) {
          node.traverse(o => { if (o.isMesh) o.userData.eq = e.id; });
          const box = new THREE.Box3().setFromObject(node), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length();
          e.group.visible = false; e.group = node; e.x = c.x; e.anchor.set(c.x, box.max.y + 0.6, c.z); e.focus.set(c.x, c.y, c.z); e.dist = Math.max(10, sz * 1.6); mapped++;
        } else if (a) {
          e.group.visible = false; e.group = new THREE.Group(); e.anchor.copy(M(a.label)); e.focus.copy(M(a.focus || a.label)); e.x = e.focus.x; e.dist = (a.dist ?? 40) * sc; mapped++;
          if (a.interior && e.data.interior) { const c = M([a.interior.center[0], 0, a.interior.center[1]]); e.interior = { cx: c.x, cz: c.z, y0: a.interior.y0 * sc + off.y, y1: a.interior.y1 * sc + off.y, r: a.interior.r * sc }; }
        }
      });
      if (!mapped) { this._emitModel('glb-no-nodes', url, 0); return; }
      this.root.children.filter(c => c.isLine).forEach(l => this.root.remove(l));
      this.root.add(model); this.anchorMode = !!cfg?.anchors;
      this.path = cfg?.flow ? cfg.flow.map(M) : [this.eqs[0].focus.clone().add(new THREE.Vector3(-6, 0, 0)), ...this.eqs.map(e => e.focus.clone()), this.eqs[this.eqs.length - 1].focus.clone().add(new THREE.Vector3(6, 0, 0))];
      if (cfg?.home) { this.home = { ...this.home, ...cfg.home }; this.reset(); }
      this.ring.scale.setScalar(cfg?.ringScale ?? 1);
      this.stop(); this._setMaterial(0, this.path[0]);
      this._applySelection();
      this._emitModel('glb', url, mapped);
    }, undefined, () => { if (this.process === p) this._emitModel('primitive', url); });
  }
  _emitModel(status, url, mapped = 0) { this.dispatchEvent(new CustomEvent('steel-model', { detail: { status, url, mapped, process: this.process?.id }, bubbles: true, composed: true })); }
  _setMaterial(stateIdx, x) {
    if (this.matIdx !== stateIdx) {
      if (this.material) this.scene.remove(this.material);
      this.material = materialMesh(this.states[stateIdx]); this.material.name = 'MATERIAL'; this.scene.add(this.material);
      this.matIdx = stateIdx;
    }
    this.material.position.copy(x);
  }
  _applySelection() {
    const id = this.getAttribute('selected');
    this.eqs.forEach(e => {
      const on = e.id === id;
      e.group.traverse(o => { if (o.isMesh && o.material.emissive) { o.material.emissive.setHex(on ? ACCENT : o.userData.base); o.material.emissiveIntensity = on ? 0.35 : (o.userData.base ? 0.6 : 0); } });
    });
    this._styleLabels();
    const sel = this.eqs.find(e => e.id === id);
    this._showInterior(sel && sel.interior ? sel : null);
    this._dimOthers(sel && sel.interior ? sel : null);
    this.ring.visible = !!sel; if (sel) this.ring.position.set(sel.focus.x, 0.02 + (this.anchorMode ? 0.4 : 0), sel.focus.z);
  }
  // 선택된 설비 내부 단면(X-ray): data.js의 equipment.interior 레이어를 색깔 층으로 표시
  _typewrite(el, text, delay, speed, showEl) {
    const target = showEl || el; const t0 = setTimeout(() => { target.style.opacity = '1'; let i = 0; const tick = () => { if (!el.isConnected) return; el.textContent = text.slice(0, ++i) + (i < text.length ? '▍' : ''); if (i < text.length) this._timers.push(setTimeout(tick, speed)); }; tick(); }, delay);
    this._timers.push(t0);
  }
  _showInterior(e) {
    (this._timers || []).forEach(clearTimeout); this._timers = [];
    if (this.interior) { this.scene.remove(this.interior); this.interior = null; }
    (this.interiorLabels || []).forEach(l => l.remove()); this.interiorLabels = []; this.layerItems = []; this.activeLayer = null;
    if (!e) return;
    const { cx, cz, y0, y1, r } = e.interior, layers = e.data.interior, H = y1 - y0, layout = e.data.interiorLayout || 'stack';
    const g = new THREE.Group(); let y = y1, x = cx - r * 1.6;
    const W = r * 3.2, mat = (c, op = 0.9) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthTest: false });
    this.interiorSpan = layout === 'stack' || layout === 'stove' ? H : W;
    layers.forEach((L, idx) => {
      let m, mid, h = L.h * H, cardX;
      if (layout === 'bed') {            // 소결: 수평 이동 베드 — 왼쬭→오른쬭 구간
        const w = L.h * W, bh = H * 0.45; m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, bh, r * 1.2), mat(L.color));
        m.position.set(x + w / 2, y0 + bh / 2, cz); mid = m.position.clone(); x += w;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, bh * 0.12, r * 1.3), mat(0x2a2f36, 0.95)); rail.position.set(mid.x, y0 - bh * 0.06, cz); rail.renderOrder = 10; g.add(rail);
        h = bh; cardX = mid.x;
      } else if (layout === 'chambers') { // 코크스: 좁은 탄화실이 나란히 — 연소실 벽은 사이사이 얇은 벽
        if (L.wall) {
          m = new THREE.Group(); const n = layers.filter(q => !q.wall).length, cw = W / n;
          for (let i = 0; i <= n; i++) { const wall = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.18, H, r * 1.5), mat(L.color)); wall.position.set(cx - W / 2 + i * cw, y0 + H / 2, cz); wall.renderOrder = 10; m.add(wall); }
          mid = new THREE.Vector3(cx, y1 + H * 0.08, cz);
        } else {
          const n = layers.filter(q => !q.wall).length, cw = W / n, i = layers.filter((q, k) => k < idx && !q.wall).length;
          m = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.74, H * 0.92, r * 1.4), mat(L.color)); m.position.set(cx - W / 2 + cw * (i + 0.5), y0 + H * 0.46, cz); mid = m.position.clone();
        }
        h = H; cardX = mid.x;
      } else if (layout === 'stove' && idx === 0) {   // 열풍로: 돔
        m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(L.color)); m.position.set(cx, y - h, cz); mid = new THREE.Vector3(cx, y - h * 0.4, cz); y -= h;
      } else if (layout === 'stove' && idx === layers.length - 1) {   // 열풍로: 열풍 출구 관 (오른쬭으로)
        m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 2.4, 16), mat(L.color)); m.rotation.z = Math.PI / 2; m.position.set(cx + r + r * 1.2, y0 + H * 0.12, cz); mid = m.position.clone();
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 0.6, 16), mat(L.color)); arrow.rotation.z = -Math.PI / 2; arrow.position.set(cx + r + r * 2.6, y0 + H * 0.12, cz); arrow.renderOrder = 10; g.add(arrow);
      } else {                            // 기본: 수직 층 (고로 등)
        m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), mat(L.color)); m.position.set(cx, y - h / 2, cz); mid = m.position.clone(); y -= h;
      }
      m.renderOrder = 10; m.traverse(o => { o.renderOrder = 10; }); g.add(m);
      // 온도 칩: 층 안쪽 중앙, 클릭 → 그 층으로 포커스 + 설명 등장
      const tl = document.createElement('button');
      tl.textContent = L.temp || '·';
      Object.assign(tl.style, { position: 'absolute', transform: 'translate(-50%,-50%)', fontFamily: '"IBM Plex Mono", monospace', fontSize: '12px', fontWeight: '700', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'pointer', color: '#fff', background: 'rgba(8,12,18,.45)', border: '1px solid rgba(255,255,255,.35)', borderRadius: '999px', padding: '4px 10px', textShadow: '0 0 6px rgba(0,0,0,.9)', opacity: '0', transition: 'opacity .3s, transform .2s, background .2s, border-color .2s', pointerEvents: 'auto' });
      tl._pos = mid; this.labels.appendChild(tl); this.interiorLabels.push(tl);
      this._timers.push(setTimeout(() => { tl.style.opacity = '1'; }, 120 * idx + 200));
      tl.onmouseenter = () => { if (this.activeLayer !== idx) tl.style.transform = 'translate(-50%,-50%) scale(1.08)'; };
      tl.onmouseleave = () => { if (this.activeLayer !== idx) tl.style.transform = 'translate(-50%,-50%)'; };
      // 설명 카드: 처음엔 숨김
      const card = document.createElement('div');
      card.innerHTML = `<em></em><b></b><span></span>${L.formula ? '<code></code>' : ''}`;
      Object.assign(card.style, { position: 'absolute', transform: 'translate(0,-50%)', display: 'none', flexDirection: 'column', gap: '5px', padding: '12px 14px 12px 16px', borderRadius: '10px', fontFamily: '"IBM Plex Sans KR", sans-serif', fontSize: '13px', lineHeight: '1.35', whiteSpace: 'nowrap', pointerEvents: 'none', color: '#f3f5f8', background: `linear-gradient(135deg, ${L.color}33, rgba(8,12,18,.85) 60%)`, border: `1px solid ${L.color}88`, boxShadow: `0 0 0 1px rgba(0,0,0,.4), 0 14px 40px rgba(0,0,0,.55), inset 3px 0 0 ${L.color}`, backdropFilter: 'blur(10px)', opacity: '0', transition: 'opacity .35s' });
      card.querySelector('em').style.cssText = `font-style:normal;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.16em;color:${L.color}`;
      card.querySelector('b').style.cssText = 'font-size:15px;font-weight:700;letter-spacing:-0.01em';
      card.querySelector('span').style.cssText = 'font-size:12px;color:rgba(243,245,248,.8);white-space:normal;max-width:300px;line-height:1.5';
      const code = card.querySelector('code'); if (code) code.style.cssText = `font-family:"IBM Plex Mono",monospace;font-size:12px;color:${L.color};margin-top:2px`;
      const horiz = layout === 'bed' || layout === 'chambers';
      card._pos = horiz ? new THREE.Vector3(mid.x, y1 + H * 0.35, cz) : new THREE.Vector3(mid.x + r * 1.25, mid.y, cz);
      card._posL = horiz ? card._pos.clone() : new THREE.Vector3(mid.x - r * 1.25, mid.y, cz); card._card = true; card._up = horiz; this.labels.appendChild(card); this.interiorLabels.push(card);
      this.layerItems.push({ L, m, tl, card, mid, h, idx });
      tl.onclick = (ev) => { ev.stopPropagation(); this._focusLayer(idx); };
    });
    if (layout === 'stack') { const sh = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, H, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthTest: false })); sh.position.set(cx, (y0 + y1) / 2, cz); sh.renderOrder = 11; g.add(sh); }
    this.interior = g; this.scene.add(g);
  }
  _focusLayer(idx) {
    (this._timers || []).forEach(clearTimeout); this._timers = [];
    const same = this.activeLayer === idx; this.activeLayer = same ? null : idx;
    const e = this.eqs.find(q => q.id === this.getAttribute('selected'));
    this.layerItems.forEach(it => {
      const on = it.idx === this.activeLayer, none = this.activeLayer === null;
      const op = none || on ? 0.9 : 0.22; it.m.traverse(o => { if (o.isMesh) o.material.opacity = op; });
      it.tl.style.opacity = none || on ? '1' : '0.35';
      it.tl.style.transform = on ? 'translate(-50%,-50%) scale(1.15)' : 'translate(-50%,-50%)';
      it.tl.style.background = on ? it.L.color : 'rgba(8,12,18,.45)';
      it.tl.style.borderColor = on ? it.L.color : 'rgba(255,255,255,.35)';
      it.tl.style.color = on ? '#0b0f14' : '#fff';
      it.card.style.display = on ? 'flex' : 'none'; it.card.style.opacity = '0';
      if (on) {
        const em = it.card.querySelector('em'), b = it.card.querySelector('b'), sp = it.card.querySelector('span'), code = it.card.querySelector('code');
        em.textContent = ''; b.textContent = ''; sp.textContent = ''; if (code) code.textContent = '';
        this._timers.push(setTimeout(() => { it.card.style.opacity = '1'; }, 350));
        this._typewrite(em, `LAYER ${String(it.idx + 1).padStart(2, '0')} · ${it.L.temp || '온도 유지'}`, 400, 18);
        this._typewrite(b, it.L.label, 700, 26);
        this._typewrite(sp, e?.data.steps?.[it.idx]?.text || '', 700 + it.L.label.length * 26 + 200, 12);
        if (code) this._typewrite(code, it.L.formula, 700 + it.L.label.length * 26 + 200 + (e?.data.steps?.[it.idx]?.text || '').length * 12 + 200, 22);
      }
    });
    if (this.activeLayer !== null && e) {
      const it = this.layerItems[idx], r = e.interior.r;
      const H = e.interior.y1 - e.interior.y0, center = (e.interior.y0 + e.interior.y1) / 2, yaw = -0.2, S = this.interiorSpan || H;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), horiz = S !== H;
      const dist = Math.max(S * (horiz ? 1.5 : 2.1), r * 7, 9);
      const tx = horiz ? e.interior.cx : it.mid.x;
      this._animateTo({ yaw, pitch: horiz ? 0.25 : 0.05, dist, target: new THREE.Vector3(tx, center + (horiz ? H * 0.4 : H * 0.06), it.mid.z).sub(right.multiplyScalar(dist * (horiz ? 0.12 : 0.2))) });
      this.ring.visible = false;
    } else if (e) { this.focus(e.id); this.ring.visible = true; }
  }
  // 내부 단면 표시 중에는 나머지 장면을 흐리게(포커스 모드)
  _dimOthers(sel) {
    const dim = !!sel;
    const set = (o) => { if (!o.isMesh) return; if (!o.userData._m) o.userData._m = { t: o.material.transparent, op: o.material.opacity }; o.material.transparent = dim ? true : o.userData._m.t; o.material.opacity = dim ? 0.28 : o.userData._m.op; o.material.needsUpdate = true; };
    if (this.root) this.root.traverse(set);
    if (this.material) this.material.traverse(set);
    if (this.skyline) this.skyline.traverse(set);
    if (this.glow) this.glow.visible = !dim;
    if (this.stars) this.stars.material.opacity = dim ? 0.3 : 0.8;
    this.eqs.forEach(e => { if (dim && e !== sel) e.label.style.opacity = '0.2'; });
    if (this.interiorLabels) this.interiorLabels.forEach(l => l.style.zIndex = '2');
    this.dimmed = dim;
  }
  _select(id) { this.dispatchEvent(new CustomEvent('steel-select', { detail: { id }, bubbles: true, composed: true })); }
  _bindPointer() {
    const el = this.renderer.domElement; let down = null, moved = false;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; moved = false; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
    el.addEventListener('pointermove', e => {
      if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      this.orbit.yaw -= dx * 0.005; this.orbit.pitch = Math.min(1.3, Math.max(0.08, this.orbit.pitch + dy * 0.005)); down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', e => {
      el.style.cursor = 'grab';
      if (down && !moved) {
        const r = el.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.ray.setFromCamera(v, this.camera); const hit = this.ray.intersectObjects(this.root.children, true)[0];
        let id = hit ? hit.object.userData.eq : null;
        if (hit && !id && this.anchorMode) { let best = null, bd = Infinity; this.eqs.forEach(q => { const d = q.focus.distanceTo(hit.point); if (d < bd) { bd = d; best = q; } }); if (best && bd < best.dist * 0.9) id = best.id; }
        this._select(id);
      }
      down = null;
    });
    el.addEventListener('wheel', e => { e.preventDefault(); this.orbit.dist = Math.min(90, Math.max(8, this.orbit.dist * (1 + e.deltaY * 0.001))); }, { passive: false });
  }
  _frame(now) {
    if (this.anim) { const k = Math.min(1, (now - this.anim.t0) / this.anim.dur), s = k * k * (3 - 2 * k);
      this.orbit.target.lerpVectors(this.anim.from.target, this.anim.to.target, s);
      this.orbit.yaw = this.anim.from.yaw + (this.anim.to.yaw - this.anim.from.yaw) * s; this.orbit.pitch = this.anim.from.pitch + (this.anim.to.pitch - this.anim.from.pitch) * s; this.orbit.dist = this.anim.from.dist + (this.anim.to.dist - this.anim.from.dist) * s;
      if (k >= 1) this.anim = null; }
    const o = this.orbit;
    this.camera.position.set(o.target.x + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch));
    this.camera.lookAt(o.target);
    if (this.move) {
      const mv = this.move, k = Math.min(1, (now - mv.t0) / mv.dur), e = k * k * (3 - 2 * k);
      const pos = new THREE.Vector3().lerpVectors(this.path[mv.from], this.path[mv.to], e);
      if (mv.arc) pos.y += Math.sin(e * Math.PI) * mv.arc;
      this._setMaterial(k > 0.5 ? mv.state : mv.prevState, pos);
      if (this.material) this.material.rotation.y += 0.02;
      this.t = (mv.from + e) / (this.path.length - 1);
      if (now - (this.lastEmit || 0) > 120 || k >= 1) { this.lastEmit = now; this._emitProgress(); }
      if (k >= 1) { this.move = null; mv.resolve(); }
    }
    if (this.playing) {
      const t = Math.min(1, (now - this.playT0) / this.playDur); this.t = t;
      const segs = this.path.length - 1, f = t * segs, i = Math.min(segs - 1, Math.floor(f)), u = f - i;
      const x = new THREE.Vector3().lerpVectors(this.path[i], this.path[i + 1], u);
      const ns = this.states.length, sIdx = t >= 1 ? ns - 1 : Math.min(ns - 1, Math.max(0, Math.round(f - 0.5)));
      this._setMaterial(sIdx, x);
      if (this.material) this.material.rotation.y += 0.01;
      if (t >= 1) this.playing = false;
      if (now - (this.lastEmit || 0) > 120 || !this.playing) { this.lastEmit = now; this._emitProgress(); }
    }
    const w = this.clientWidth, h = this.clientHeight, v = new THREE.Vector3();
    this.eqs.forEach(e => { v.copy(e.anchor).project(this.camera); const vis = v.z < 1; e.label.style.display = vis ? 'flex' : 'none'; if (vis) { e.label.style.left = ((v.x + 1) / 2 * w) + 'px'; e.label.style.top = ((1 - v.y) / 2 * h) + 'px'; } });
    (this.interiorLabels || []).forEach(l => { if (!l._pos) return; if (l._card && l.style.display === 'none') return; v.copy(l._pos).project(this.camera); const vis = v.z < 1; l.style.display = vis ? 'flex' : 'none'; if (vis) { let px = (v.x + 1) / 2 * w; if (l._card && l._up) { const cw = l.offsetWidth || 260; px = Math.min(Math.max(px - cw / 2, 8), w - cw - 8); l.style.transform = 'translate(0,-100%)'; } else if (l._card) { const cw = l.offsetWidth || 260; if (px + cw > w - 8) { const alt = l._posL.clone().project(this.camera); px = (alt.x + 1) / 2 * w; l.style.transform = 'translate(-100%,-50%)'; } else l.style.transform = 'translate(0,-50%)'; } l.style.left = px + 'px'; l.style.top = ((1 - v.y) / 2 * h) + 'px'; } });
    if (this.ring.visible) this.ring.rotation.z += 0.01;
  }
  _emitProgress() { this.dispatchEvent(new CustomEvent('steel-progress', { detail: { t: this.t || 0, label: this.states[this.matIdx]?.label || '', playing: !!this.playing || !!this.touring, touring: !!this.touring, step: this.tourStep || null }, bubbles: true, composed: true })); }
  _emitTour(step) { this.tourStep = step; this.dispatchEvent(new CustomEvent('steel-tour', { detail: step, bubbles: true, composed: true })); this._emitProgress(); }
  _moveMaterial(from, to, dur, state, arc) { return new Promise(resolve => { this.move = { from, to, t0: performance.now(), dur, state, prevState: this.matIdx < 0 ? 0 : this.matIdx, arc, resolve }; }); }
  _wait(ms) { return new Promise((res) => { const tk = this._tourToken; const id = setTimeout(res, ms); this._tourWaits.push({ id, res }); }); }
  _skip() { (this._tourWaits || []).forEach(w => { clearTimeout(w.id); w.res(); }); this._tourWaits = []; if (this.move) { const mv = this.move; this.move = null; this._setMaterial(mv.state, this.path[mv.to]); mv.resolve(); } }
  // 자동 시연: 설비마다 소재 이동 → 카메라 → 내부 층 순서대로 설명
  async tour(speed = 1) {
    if (this.touring) return false;
    const token = ++this._tourId;
    try { return await this._tourBody(token, speed); }
    catch (err) { console.error('tour error', err); return false; }
    finally { if (token === this._tourId) { this.touring = false; this.tourStep = null; this.move = null; this._emitProgress(); this.dispatchEvent(new CustomEvent('steel-tour-end', { bubbles: true, composed: true })); } }
  }
  async _tourBody(token, speed) {
    this.touring = true; this._tourWaits = []; this.playing = false;
    const sp = 1 / speed, total = this.eqs.reduce((n, e) => n + 1 + (e.interior && e.data.interior ? e.data.interior.length : 0), 0) + 2;
    let step = 0;
    this._select(null); this._setMaterial(0, this.path[0]); this.t = 0;
    this._emitTour({ i: ++step, total, title: this.process.name + ' 공정 자동 시연', text: this.process.summary, eq: null });
    this.reset(); await this._wait(4500 * sp); if (token !== this._tourId) return;
    for (let k = 0; k < this.eqs.length; k++) {
      const e = this.eqs[k];
      this._emitTour({ i: ++step, total, title: `${String(k + 1).padStart(2, '0')} ${e.data.name}`, text: e.data.role, eq: e.id });
      this._select(e.id); this.focus(e.id);
      await this._moveMaterial(k, k + 1, 3200 * sp, k + 1, 1.5); if (token !== this._tourId) return;
      await this._wait(3000 * sp); if (token !== this._tourId) return;
      if (e.interior && e.data.interior && this.layerItems?.length) {
        for (let L = 0; L < this.layerItems.length; L++) {
          const it = this.layerItems[L];
          this._emitTour({ i: ++step, total, title: it.L.temp ? `${e.data.name} · ${it.L.temp}` : `${e.data.name} · ${it.L.label}`, text: it.L.temp ? it.L.label : (e.data.steps?.[L]?.zone || ''), eq: e.id, layer: L });
          this.activeLayer = null; this._focusLayer(L);
          const ln = (it.L.label.length * 26) + ((e.data.steps?.[L]?.text || '').length * 12) + ((it.L.formula || '').length * 22);
          await this._wait(Math.max(5000, 3500 + ln) * sp); if (token !== this._tourId) return;
        }
        this.activeLayer = null; this.layerItems.forEach(it => { it.m.traverse(o => { if (o.isMesh) o.material.opacity = 0.9; }); it.tl.style.opacity = '1'; it.card.style.display = 'none'; it.tl.style.background = 'rgba(8,12,18,.45)'; it.tl.style.color = '#fff'; it.tl.style.transform = 'translate(-50%,-50%)'; it.tl.style.borderColor = 'rgba(255,255,255,.35)'; });
        this.focus(e.id); await this._wait(2200 * sp); if (token !== this._tourId) return;
      }
    }
    this._emitTour({ i: ++step, total, title: '완료', text: this.states[this.states.length - 1].label + ' → 다음 공정으로', eq: null });
    this._select(null); this.reset();
    await this._moveMaterial(this.eqs.length, this.eqs.length + 1, 3200 * sp, this.states.length - 1, 0); if (token !== this._tourId) return;
    await this._wait(3000 * sp);
    return true;
  }
  next() { if (this.touring) this._skip(); }
  stopTour() { if (!this.touring) return; this._tourId++; this._skip(); this.move = null; this.touring = false; this.tourStep = null; this._select(null); this.reset(); this.stop(); }
  // 공개 API
  play(speed = 1) { this.playing = true; this.t = 0; this.playT0 = performance.now(); this.playDur = (this.path.length - 1) * 2600 / speed; this._setMaterial(0, this.path[0]); this._emitProgress(); return true; }
  stop() { if (this.touring) return this.stopTour(); this.playing = false; this.t = 0; this.matIdx = -1; this._emitProgress(); }
  toggle(speed) { (this.playing || this.touring) ? this.stop() : this.tour(speed); }
  focus(id) { const e = this.eqs.find(q => q.id === id); if (!e) return false; const inner = !!e.interior; this._animateTo({ yaw: inner ? -0.25 : -0.5, pitch: inner ? 0.12 : 0.35, dist: inner ? e.dist * 0.75 : e.dist, target: inner ? new THREE.Vector3(e.interior.cx, (e.interior.y0 + e.interior.y1) / 2, e.interior.cz) : e.focus.clone() }); return true; }
  reset() { this._animateTo({ yaw: this.home.yaw, pitch: this.home.pitch, dist: this.home.dist, target: new THREE.Vector3().fromArray(this.home.target) }); }
  _animateTo(to) { this.anim = { t0: performance.now(), dur: 700, from: { yaw: this.orbit.yaw, pitch: this.orbit.pitch, dist: this.orbit.dist, target: this.orbit.target.clone() }, to }; }
}
customElements.define('steel-scene', SteelScene);
