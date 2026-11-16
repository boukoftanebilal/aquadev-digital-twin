// twin.js — realistic 3D model of the shrimp farm hall, the water treatment block and the
// Innovation Oasis campus around them. World axes: X = plan x (grid A→V), Z = plan y, Y = level (m).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FARM, TANKS, TANK_SPEC, CORRIDORS, SUMPS, ROOMS, DOORS, WT_TANKS, GRID_X, GRID_Y, BAYS } from './model.js';
import { BOUNDARY, ROADS, PARKING, ZONES, BUILDINGS, POND, FARM_ZONE } from './site.js';

const L = FARM.levels, V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const rnd = (a, b = 0) => { let h = Math.imul(a * 73856093 ^ b * 19349663, 2654435761); h ^= h >>> 15; return ((h >>> 0) % 10000) / 10000; };

// ---- procedural textures ---------------------------------------------------------------
function canvasTex(size, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size; draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const speckle = (base, spread, n = 9000) => (g, s) => { g.fillStyle = base; g.fillRect(0, 0, s, s); for (let i = 0; i < n; i++) { const v = Math.floor(rnd(i, 7) * spread); g.fillStyle = `rgba(${rnd(i, 3) > 0.5 ? 255 : 0},${rnd(i, 3) > 0.5 ? 250 : 0},${rnd(i, 3) > 0.5 ? 235 : 0},${v / 255})`; g.fillRect(rnd(i, 1) * s, rnd(i, 2) * s, 1 + rnd(i, 5) * 2, 1 + rnd(i, 6) * 2); } };
const stripes = (a, b, period, w) => (g, s) => { g.fillStyle = a; g.fillRect(0, 0, s, s); g.fillStyle = b; for (let x = 0; x < s; x += period) g.fillRect(x, 0, w, s); };
function waterNormals() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d'), img = g.createImageData(s, s), k = 2 * Math.PI / s;
  const H = (x, y) => Math.sin(k * (3 * x + 2 * y)) + 0.7 * Math.sin(k * (5 * y - 2 * x) + 1.3) + 0.5 * Math.sin(k * (9 * x + 7 * y) + 0.4) + 0.35 * Math.sin(k * (13 * x - 11 * y) + 2.1);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1), n = new THREE.Vector3(-dx * 0.9, -dy * 0.9, 1).normalize(), o = (y * s + x) * 4;
    img.data[o] = (n.x * 0.5 + 0.5) * 255; img.data[o + 1] = (n.y * 0.5 + 0.5) * 255; img.data[o + 2] = (n.z * 0.5 + 0.5) * 255; img.data[o + 3] = 255; }
  g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.2, 2.2); return t;
}

// ---- geometry helpers ------------------------------------------------------------------
function rrShape(x0, y0, x1, y1, r, target = new THREE.Shape()) { // rounded rect in plan, mapped to shape (x, −y)
  const X0 = x0, X1 = x1, Y0 = -y1, Y1 = -y0;
  target.moveTo(X0 + r, Y0); target.lineTo(X1 - r, Y0); target.absarc(X1 - r, Y0 + r, r, -Math.PI / 2, 0, false);
  target.lineTo(X1, Y1 - r); target.absarc(X1 - r, Y1 - r, r, 0, Math.PI / 2, false);
  target.lineTo(X0 + r, Y1); target.absarc(X0 + r, Y1 - r, r, Math.PI / 2, Math.PI, false);
  target.lineTo(X0, Y0 + r); target.absarc(X0 + r, Y0 + r, r, Math.PI, Math.PI * 1.5, false);
  return target;
}
function ring(x0, y0, x1, y1, r, grow, inset = 0) {
  const s = rrShape(x0 - grow, y0 - grow, x1 + grow, y1 + grow, r + grow);
  s.holes.push(rrShape(x0 - inset, y0 - inset, x1 + inset, y1 + inset, r + inset, new THREE.Path())); return s;
}
const flat = g => { g.rotateX(-Math.PI / 2); return g; };
function box(x0, x1, z0, z1, y0, y1, mat, shadow = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); m.castShadow = shadow > 0; m.receiveShadow = true; return m;
}
function pipe(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize()); return m;
}
function arc(z0, z1, eave, crown) { const c = z1 - z0, s = crown - eave, R = (c * c / 4 + s * s) / (2 * s); return { R, cy: crown - R, half: Math.asin(c / 2 / R), zc: (z0 + z1) / 2 }; }
function vaultGeo(x0, x1, a, n = 24, ru = 20) {
  const pos = [], uv = [], idx = [];
  for (let v = 0; v <= n; v++) { const th = -a.half + 2 * a.half * v / n, y = a.cy + a.R * Math.cos(th), z = a.zc + a.R * Math.sin(th); pos.push(x0, y, z, x1, y, z); uv.push(0, v / n, ru, v / n); }
  for (let v = 0; v < n; v++) { const k = v * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function gableGeo(x, a, eave, n = 16) {
  const pos = [x, eave, a.zc], idx = [];
  for (let v = 0; v <= n; v++) { const th = -a.half + 2 * a.half * v / n; pos.push(x, a.cy + a.R * Math.cos(th), a.zc + a.R * Math.sin(th)); if (v) idx.push(0, v, v + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}

export class Twin {
  constructor(host, { onPick, onHover } = {}) {
    this.host = host; this.onPick = onPick; this.onHover = onHover;
    this.tanks = new Map(); this.labels = []; this.layers = {}; this.pulse = 0; this.roofMode = 'auto'; this.roofT = 1; this.shell = []; this.lid = [];
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    host.appendChild(r.domElement);
    this.overlay = document.createElement('div'); this.overlay.className = 'twin-labels'; host.appendChild(this.overlay);
    this.scene = new THREE.Scene(); this.scene.fog = new THREE.Fog(0xdfe9f1, 500, 1900);
    this.camera = new THREE.PerspectiveCamera(32, 1, 1, 2600);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: Math.PI / 2 - 0.03, minDistance: 5, maxDistance: 1100, zoomSpeed: 0.9 });
    this.sky(); this.build(); this.campus();
    new ResizeObserver(() => this.resize()).observe(host); this.resize();
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.setView(calm ? 'inside' : 'farm', true); if (!calm) setTimeout(() => this.setView('inside'), 1400);
    this.bindPointer();
    this.running = true; const loop = () => { if (this.running) this.frame(); requestAnimationFrame(loop); }; loop();
  }
  layer(name) { if (!this.layers[name]) { const g = new THREE.Group(); g.name = name; this.layers[name] = g; this.scene.add(g); } return this.layers[name]; }
  setLayer(name, on) { if (this.layers[name]) this.layers[name].visible = on; for (const l of this.labels) if (l.layer === name) l.on = on; }
  setRoof(mode) { this.roofMode = mode; }
  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/jpeg', 0.86); }
  addLabel(text, pos, cls, layer, data) {
    const el = document.createElement(data ? 'button' : 'div'); el.className = 'tl ' + cls; el.innerHTML = text;
    if (data) { el.type = 'button'; el.addEventListener('click', e => { e.stopPropagation(); this.onPick && this.onPick(data.tank); }); }
    this.overlay.appendChild(el); const l = { el, pos, layer, on: true, data }; this.labels.push(l); return l;
  }

  sky() {
    const sky = new THREE.Mesh(new THREE.SphereGeometry(2200, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 p; void main(){ float h = normalize(p).y; vec3 top = vec3(0.36,0.60,0.86), hor = vec3(0.90,0.94,0.97), gnd = vec3(0.80,0.74,0.62); vec3 c = h > 0.0 ? mix(hor, top, pow(h, 0.55)) : mix(hor, gnd, min(1.0, -h * 6.0)); gl_FragColor = vec4(c, 1.0); }' }));
    const env = new THREE.Scene(); env.add(sky.clone()); const pm = new THREE.PMREMGenerator(this.renderer); this.scene.environment = pm.fromScene(env, 0.02, 1, 3000).texture; pm.dispose();
    this.scene.add(sky); this.scene.environmentIntensity = 0.7;
    this.scene.add(new THREE.HemisphereLight(0xdfeeff, 0xcbb994, 0.55));
    const sun = this.sun = new THREE.DirectionalLight(0xfff3df, 2.6); sun.position.set(-70, 150, 115); sun.target.position.set(50, 0, 25); sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 90, bottom: -90, near: 20, far: 420 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
    this.scene.add(sun, sun.target);
  }

  build() {
    const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
    const base = this.layer('base'), eq = this.layer('equipment'), pipes = this.layer('piping'), structure = this.layer('structure'), grid = this.layer('grid'), sensors = this.layer('sensors');
    const hall = this.layer('hall'), wx = FARM.wtBlock.x0, wy = FARM.wtBlock.y0;
    const fade = (m, set) => { m.transparent = true; set.push(m); return m; };

    // slabs and floor finishes
    const floorMat = M(0xcfd6dc, { roughness: 0.45, map: canvasTex(256, speckle('#d2d8dd', 26, 5000), 30, 18) });
    base.add(box(0, 85, 0, 50, -0.3, 0, floorMat), box(wx, wx + 14, wy, wy + 12.15, -0.3, 0.15, floorMat), box(-1.2, 86.2, -1.2, 51.2, -0.6, -0.06, M(0xb9b3a6)));
    const grate = M(0x59626b, { roughness: 0.5, metalness: 0.7, map: canvasTex(64, (g, s) => { g.fillStyle = '#6b747d'; g.fillRect(0, 0, s, s); g.fillStyle = '#2f363c'; for (let i = 0; i < s; i += 8) { g.fillRect(i, 0, 5, s); } }, 60, 1) });
    for (const c of CORRIDORS) { const z = (c.y0 + c.y1) / 2; base.add(box(0.6, 80.5, z - 0.45, z + 0.45, 0, 0.015, grate)); }
    for (const s of SUMPS) base.add(box(s.x - s.w / 2, s.x + s.w / 2, s.y - s.d / 2, s.y + s.d / 2, 0, 0.03, grate));

    // tanks
    this.waterN = waterNormals();
    const linerMat = M(0x6e1f2e, { roughness: 0.42 }), bedMat = M(0x4a565a, { roughness: 0.9 }), pvc = M(0xf2f4f5, { roughness: 0.35 }), valve = M(0xc8281e, { roughness: 0.4 });
    const colMat = M(0xe2a93a, { roughness: 0.32 }), pumpMat = M(0x2e8f5a, { roughness: 0.45 }), steel = M(0x9aa4ae, { roughness: 0.4, metalness: 0.85 });
    for (const t of TANKS) {
      const r = TANK_SPEC.cornerRadius, w = TANK_SPEC.wall, depth = L.tankRim - L.tankFloor;
      const wall = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(ring(t.x0, t.y0, t.x1, t.y1, r, 0, -w), { depth, bevelEnabled: false, curveSegments: 8 })), linerMat);
      wall.position.y = L.tankFloor; wall.castShadow = wall.receiveShadow = true;
      const inner = () => flat(new THREE.ShapeGeometry(rrShape(t.x0 + w, t.y0 + w, t.x1 - w, t.y1 - w, r - w), 8));
      const floor = new THREE.Mesh(inner(), bedMat); floor.position.y = L.tankFloor + 0.02; floor.receiveShadow = true;
      const water = new THREE.Mesh(inner(), new THREE.MeshStandardMaterial({ color: 0x3f8fa3, roughness: 0.1, metalness: 0.05, normalMap: this.waterN, normalScale: new THREE.Vector2(0.45, 0.45), transparent: true, opacity: 0.94, envMapIntensity: 0.9 }));
      water.receiveShadow = true; water.userData.tank = floor.userData.tank = t.id;
      const halo = new THREE.Mesh(flat(new THREE.ShapeGeometry(ring(t.x0, t.y0, t.x1, t.y1, r, 0.45), 6)), new THREE.MeshBasicMaterial({ color: 0xd03b3b, transparent: true, opacity: 0.9, toneMapped: false }));
      halo.position.y = 0.04; halo.visible = false;
      const sel = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(ring(t.x0, t.y0, t.x1, t.y1, r, 0.18, 0.02), { depth: 0.12, bevelEnabled: false, curveSegments: 6 })), new THREE.MeshBasicMaterial({ color: 0x3fa8cd, toneMapped: false }));
      sel.position.y = L.tankRim + 0.02; sel.visible = false;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.35, 12), pvc); stand.position.set(t.cx, L.tankFloor + 0.67, t.cy);
      base.add(wall, floor, water, halo, sel, stand);
      // treatment column, pump and tank pipework on the corridor side (taken from the renders)
      const col = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.1, 24), colMat), cone = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.78, 24), colMat), band = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.07, 24), colMat);
      body.position.y = 1.05; cone.position.y = 2.49; band.position.y = 2.1; body.castShadow = cone.castShadow = true; col.add(body, cone, band); col.position.set(t.column.x, 0, t.column.y); eq.add(col);
      eq.add(box(t.pump.x - 0.32, t.pump.x + 0.32, t.pump.y - 0.22, t.pump.y + 0.22, 0, 0.5, pumpMat, 1));
      const edgeZ = t.side < 0 ? t.y1 : t.y0, px = t.column.x - 1.6;
      pipes.add(pipe(V3(t.column.x, 2.88, t.column.y), V3(t.column.x, 3.35, t.column.y), 0.06, pvc), pipe(V3(px, 1.25, t.column.y), V3(px, 1.25, edgeZ + t.side * 1.3), 0.07, pvc),
        pipe(V3(px, 1.25, t.column.y), V3(t.column.x - 0.5, 1.25, t.column.y), 0.07, pvc), pipe(V3(px, 1.25, edgeZ + t.side * 1.3), V3(px, 0.75, edgeZ + t.side * 1.3), 0.07, pvc));
      const vv = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), valve); vv.position.set(px, 1.25, t.column.y - t.side * 0.02); pipes.add(vv);
      const sn = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: 0x0ca30c, toneMapped: false })); sn.position.set(t.cx - 3.2, 1.55, edgeZ);
      sensors.add(sn, pipe(V3(t.cx - 3.2, 0.9, edgeZ), V3(t.cx - 3.2, 1.5, edgeZ), 0.035, steel));
      const label = this.addLabel(`<b>${t.id}</b><i></i>`, V3(t.cx, L.tankRim + 0.4, t.cy), 'tank', 'labels', { tank: t.id });
      this.tanks.set(t.id, { t, water, floor, halo, sel, sn, label });
    }
    this.pickables = [...this.tanks.values()].flatMap(o => [o.water, o.floor]);
    for (const c of CORRIDORS) { const z = (c.y0 + c.y1) / 2; pipes.add(pipe(V3(1.5, 3.35, z - 0.62), V3(79, 3.35, z - 0.62), 0.09, pvc), pipe(V3(1.5, 3.35, z + 0.62), V3(79, 3.35, z + 0.62), 0.09, pvc)); }
    pipes.add(pipe(V3(79, 3.35, 5.5), V3(79, 3.35, 38), 0.11, pvc), pipe(V3(79, 3.35, 5.5), V3(92, 3.35, 5.5), 0.11, pvc), pipe(V3(92, 3.35, 5.5), V3(92, 2.3, 5.5), 0.11, pvc));

    // service rooms (sandwich panel) along grid U–V
    const panelTex = n => canvasTex(128, (g, s) => { g.fillStyle = '#f4f6f7'; g.fillRect(0, 0, s, s); g.fillStyle = '#d5dade'; g.fillRect(0, 0, 3, s); g.fillStyle = '#ffffff'; g.fillRect(3, 0, 2, s); }, n, 1);
    const roomMat = M(0xffffff, { roughness: 0.55, map: panelTex(6) }), glass = M(0x26333d, { roughness: 0.08, metalness: 0.6 }), doorMat = M(0x8b96a1, { roughness: 0.5, metalness: 0.4 });
    for (const rm of ROOMS) { const g = box(rm.x0, rm.x1, rm.y0, rm.y1, 0, 0.3 + rm.h, roomMat, 1); base.add(g);
      for (let z = rm.y0 + 1.2; z < rm.y1 - 1.4; z += 3.2) base.add(box(rm.x0 - 0.03, rm.x0, z, z + 1.6, 1.45, 2.5, glass));
      this.addLabel(rm.name, V3((rm.x0 + rm.x1) / 2, 0.3 + rm.h + 0.6, (rm.y0 + rm.y1) / 2), 'room', 'labels'); }

    // water treatment block: two concrete tanks, access platform
    const conc = M(0xb7bcc1, { roughness: 0.9, map: canvasTex(256, speckle('#b9bec3', 40, 6000), 3, 1) });
    this.wt = WT_TANKS.map(w => {
      for (const [a, b, c, d] of [[w.x0 - 0.25, w.x1 + 0.25, w.y0 - 0.25, w.y0], [w.x0 - 0.25, w.x1 + 0.25, w.y1, w.y1 + 0.25], [w.x0 - 0.25, w.x0, w.y0, w.y1], [w.x1, w.x1 + 0.25, w.y0, w.y1]]) base.add(box(a, b, c, d, w.floor, w.top, conc, 1));
      const water = box(w.x0, w.x1, w.y0, w.y1, 0, 1, new THREE.MeshStandardMaterial({ color: 0x2f86ad, roughness: 0.1, normalMap: this.waterN, normalScale: new THREE.Vector2(0.3, 0.3), transparent: true, opacity: 0.9 }));
      water.geometry.translate(0, 0.5, 0); water.position.y = w.floor; base.add(water);
      const label = this.addLabel(`<b>${w.name}</b><i></i>`, V3((w.x0 + w.x1) / 2, w.top + 0.6, (w.y0 + w.y1) / 2), 'wtl', 'labels'); return { w, water, label };
    });
    base.add(box(89.3, 93.3, 10.3, 11.4, 0.15, 1.35, grate, 1));

    // steel frame: columns on every grid line, vault trusses, luminaires
    const lines = [], bays = BAYS.map(([z0, z1]) => arc(z0, z1, L.eave, L.crown));
    for (const a of bays) for (const gx of GRID_X) { const n = 12; let pT = null, pB = null;
      for (let k = 0; k <= n; k++) { const th = -a.half + 2 * a.half * k / n, T = [gx.x, a.cy + a.R * Math.cos(th) - 0.06, a.zc + a.R * Math.sin(th)], B = [gx.x, a.cy + (a.R - 0.6) * Math.cos(th) - 0.1, a.zc + (a.R - 0.6) * Math.sin(th)];
        if (pT) lines.push(...pT, ...T, ...pB, ...B, ...(k % 2 ? [...pB, ...T] : [...pT, ...B])); pT = T; pB = B; } }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    structure.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x7d8792 })));
    const colZ = [0.25, 12.5, 25, 37.5, 49.75], cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.11, L.eave, 10), steel, GRID_X.length * colZ.length), m4 = new THREE.Matrix4(); let n = 0;
    for (const gx of GRID_X) for (const z of colZ) { m4.makeTranslation(Math.min(Math.max(gx.x, 0.25), 84.75), L.eave / 2, z); cols.setMatrixAt(n++, m4); }
    cols.castShadow = true; structure.add(cols);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, toneMapped: false });
    for (const z of [12.5, 37.5]) for (let x = 6; x < 80; x += 12) structure.add(box(x - 0.6, x + 0.6, z - 0.12, z + 0.12, 4.0, 4.08, lampMat));

    // envelope: sandwich-panel walls with windows and doors, four barrel vaults with skylights and ridge monitors
    const wallMat = fade(M(0xf3f5f6, { roughness: 0.5, side: THREE.DoubleSide, map: panelTex(1) }), this.shell), glassF = fade(M(0x1f2c36, { roughness: 0.06, metalness: 0.7 }), this.shell), doorF = fade(M(0x7f8a95, { roughness: 0.5, metalness: 0.4 }), this.shell);
    const roofMat = fade(M(0xdfe6ec, { roughness: 0.42, metalness: 0.25, side: THREE.DoubleSide, map: canvasTex(64, stripes('#e6ecf1', '#c9d2da', 16, 3), 1, 1) }), this.lid);
    const skyl = fade(new THREE.MeshStandardMaterial({ color: 0xbfe6f2, roughness: 0.1, metalness: 0.2, emissive: 0x6fb9d6, emissiveIntensity: 0.25, transparent: true }), this.lid), monMat = fade(M(0xcfd7de, { roughness: 0.5, metalness: 0.3 }), this.lid);
    const wallRun = (x0, x1, z0, z1, y0, y1, g) => { const len = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)), m = wallMat.clone(); m.map = wallMat.map.clone(); m.map.repeat.set(len / 1.0, 1); m.map.needsUpdate = true; this.shell.push(m); const b = box(x0, x1, z0, z1, y0, y1, m, 1); g.add(b); return b; };
    wallRun(0, 85, -0.1, 0.1, 0, L.eave, hall); wallRun(0, 85, 49.9, 50.1, 0, L.eave, hall); wallRun(-0.1, 0.1, 0, 50, 0, L.eave, hall); wallRun(84.9, 85.1, 0, 50, 0, L.eave, hall);
    for (const z of [-0.14, 50.14]) { for (let x = 6; x < 80; x += 8) hall.add(box(x - 0.9, x + 0.9, z - 0.02, z + 0.02, 1.5, 2.6, glassF)); for (const x of [2.3, 34.3]) hall.add(box(x - 1, x + 1, z - 0.03, z + 0.03, 0, 2.5, doorF)); }
    for (const d of DOORS) hall.add(box(85.1, 85.16, d.y0, d.y1, 0, 2.6, doorF));
    bays.forEach((a, i) => {
      const v = new THREE.Mesh(vaultGeo(0, 85, a, 24, 140), roofMat); v.castShadow = true; hall.add(v);
      for (const x of [0, 85]) hall.add(new THREE.Mesh(gableGeo(x, a, L.eave), wallMat));
      const mon = box(2, 83, a.zc - 1, a.zc + 1, L.crown - 0.08, L.monitorTop, monMat, 1); hall.add(mon);
      for (const sgn of [-1, 1]) for (let x = 7; x < 80; x += 7.3) { const th = sgn * a.half * 0.52, p = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3.3), skyl); p.position.set(x, a.cy + (a.R + 0.05) * Math.cos(th), a.zc + (a.R + 0.05) * Math.sin(th)); p.rotation.x = th - Math.PI / 2; hall.add(p); }
      if (i) hall.add(box(0, 85, a.zc - 6.4, a.zc - 6.1, L.eave - 0.25, L.eave + 0.05, monMat));
    });
    const wa = arc(wy, wy + 12.15, 3.2, 4.9); wallRun(wx, wx + 14, wy - 0.08, wy + 0.08, 0.15, 3.2, hall); wallRun(wx, wx + 14, wy + 12.07, wy + 12.23, 0.15, 3.2, hall); wallRun(wx - 0.08, wx + 0.08, wy, wy + 12.15, 0.15, 3.2, hall); wallRun(wx + 13.92, wx + 14.08, wy, wy + 12.15, 0.15, 3.2, hall);
    const wv = new THREE.Mesh(vaultGeo(wx, wx + 14, wa, 16, 24), roofMat); wv.castShadow = true; hall.add(wv); for (const x of [wx, wx + 14]) hall.add(new THREE.Mesh(gableGeo(x, wa, 3.2), wallMat));
    hall.add(box(wx + 1, wx + 2.1, wy + 12.2, wy + 12.26, 0.15, 2.4, doorF), box(wx + 11.6, wx + 12.7, wy + 12.2, wy + 12.26, 0.15, 2.4, doorF));
    this.roofCasters = hall.children.filter(m => m.castShadow);

    // structural grid
    const gl = [];
    for (const g of GRID_X) { gl.push(g.x, 0.03, -3, g.x, 0.03, 53); this.addLabel(g.name, V3(g.x, 0.1, -4.2), 'grid', 'grid'); }
    for (const g of GRID_Y) { gl.push(-3, 0.03, g.y, 88, 0.03, g.y); this.addLabel(g.name, V3(-4.2, 0.1, g.y), 'grid', 'grid'); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
    grid.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x33495f, transparent: true, opacity: 0.6 })));
  }

  campus() {
    const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o }), site = this.layer('campus');
    const P = (x0, x1, z0, z1, y, mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(z1 - z0)), mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); m.receiveShadow = true; return m; };
    const ground = P(-2200, 2200, -2200, 2200, -0.7, M(0xd9c8a3, { map: canvasTex(512, speckle('#dccba6', 46, 22000), 260, 260) })); this.scene.add(ground);
    const b = new THREE.Shape(BOUNDARY.map(p => new THREE.Vector2(p[0], -p[1]))), lot = new THREE.Mesh(flat(new THREE.ShapeGeometry(b)), M(0xcdbb95, { map: canvasTex(512, speckle('#d0be98', 40, 22000), 60, 60) })); lot.position.y = -0.56; lot.receiveShadow = true; site.add(lot);
    const fence = M(0xe9ecee, { roughness: 0.6 }); BOUNDARY.forEach((p, i) => { const q = BOUNDARY[(i + 1) % BOUNDARY.length], w = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(q[0] - p[0], q[1] - p[1]), 2, 0.25), fence); w.position.set((p[0] + q[0]) / 2, 0.6, (p[1] + q[1]) / 2); w.rotation.y = -Math.atan2(q[1] - p[1], q[0] - p[0]); site.add(w); });
    const asphalt = M(0x4b4f55, { roughness: 0.95, map: canvasTex(256, speckle('#4d5157', 30, 9000), 40, 4) }), kerb = M(0xc9cbc9), paint = new THREE.MeshBasicMaterial({ color: 0xf2f2ee });
    for (const [x0, y0, x1, y1, w] of ROADS) { const h = x0 === x1; site.add(h ? P(x0 - w / 2, x0 + w / 2, y0 - w / 2, y1 + w / 2, -0.4, asphalt) : P(x0 - w / 2, x1 + w / 2, y0 - w / 2, y0 + w / 2, -0.4, asphalt));
      const len = h ? y1 - y0 : x1 - x0; for (let s = 6; s < len - 6; s += 12) site.add(h ? P(x0 - 0.08, x0 + 0.08, y0 + s, y0 + s + 4, -0.36, paint) : P(x0 + s, x0 + s + 4, y0 - 0.08, y0 + 0.08, -0.36, paint)); }
    for (const p of PARKING) { site.add(P(p.x0, p.x1, p.y0, p.y1, -0.39, asphalt)); for (let x = p.x0 + 3; x < p.x1 - 2; x += 2.6) site.add(P(x - 0.06, x + 0.06, p.y0 + 1, p.y0 + 6, -0.35, paint), P(x - 0.06, x + 0.06, p.y1 - 6, p.y1 - 1, -0.35, paint)); }
    // trial plots: fallow, young and established crop
    const crop = [M(0xffffff, { map: canvasTex(64, stripes('#cdb98f', '#b9a37a', 8, 3), 30, 1) }), M(0xffffff, { map: canvasTex(64, stripes('#cbb98d', '#93a56a', 8, 4), 34, 1) }), M(0xffffff, { map: canvasTex(64, stripes('#a9b77c', '#7f9a5c', 8, 4), 40, 1) }), M(0xffffff, { map: canvasTex(64, speckle('#d3c29c', 30, 300), 12, 12) })];
    ZONES.forEach((z, i) => { const m = crop[z.note ? 3 : Math.floor(rnd(i, 11) * 3)]; site.add(P(z.x0 + 2, z.x1 - 2, z.y0 + 2, z.y1 - 2, -0.48, m)); this.addLabel(z.note ? `${z.n}<i>${z.note}</i>` : z.n, V3((z.x0 + z.x1) / 2, 0.5, (z.y0 + z.y1) / 2), 'zone', 'campus'); });
    site.add(P(FARM_ZONE.x0 - 1.5, FARM_ZONE.x1 + 1.5, FARM_ZONE.y0 - 1.5, FARM_ZONE.y1 + 1.5, -0.44, M(0xbdb7ab)));
    this.addLabel(`<b>${FARM_ZONE.name}</b><i>zone ${FARM_ZONE.n}</i>`, V3(48, 11, 25), 'bld primary', 'campus');
    // buildings
    const white = M(0xf1f2f0, { roughness: 0.6 }), dark = M(0x2a3640, { roughness: 0.1, metalness: 0.6 }), roofG = M(0xb9c0c6, { roughness: 0.7 }), gl = new THREE.MeshStandardMaterial({ color: 0xcfeaf0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.42, envMapIntensity: 1.6 }), frame = new THREE.LineBasicMaterial({ color: 0xf7f9fa }), bed = crop[2];
    for (const bd of BUILDINGS) {
      const g = new THREE.Group(); g.position.set(bd.x, -0.5, bd.y); g.rotation.y = -(bd.rot || 0) * Math.PI / 180; site.add(g);
      const B = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
      if (bd.kind === 'greenhouse') { B(bd.w - 1.5, 0.25, bd.d - 1.5, bed); const body = B(bd.w, bd.h - 1.4, bd.d, gl); body.castShadow = false; g.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), frame).translateY((bd.h - 1.4) / 2));
        const spans = Math.max(2, Math.round(bd.w / 6.2)), sw = bd.w / spans; for (let s = 0; s < spans; s++) { const tri = new THREE.Shape([new THREE.Vector2(-sw / 2, 0), new THREE.Vector2(sw / 2, 0), new THREE.Vector2(0, 1.4)]), r = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: bd.d, bevelEnabled: false }), gl); r.position.set(-bd.w / 2 + sw * (s + 0.5), bd.h - 1.4, -bd.d / 2); g.add(r, new THREE.LineSegments(new THREE.EdgesGeometry(r.geometry), frame).translateX(r.position.x).translateY(r.position.y).translateZ(r.position.z)); } }
      else if (bd.court) { const t = (bd.w - bd.court[0]) / 2, u = (bd.d - bd.court[1]) / 2; for (const [w, d, x, z] of [[bd.w, u, 0, -(bd.d - u) / 2], [bd.w, u, 0, (bd.d - u) / 2], [t, bd.court[1], -(bd.w - t) / 2, 0], [t, bd.court[1], (bd.w - t) / 2, 0]]) { B(w, bd.h, d, white, x, 0, z); B(w + 0.06, 1.3, d + 0.06, dark, x, 1.3, z); B(w + 0.06, 1.3, d + 0.06, dark, x, 5.1, z); B(w + 0.8, 0.3, d + 0.8, roofG, x, bd.h, z); } B(bd.court[0], 0.1, bd.court[1], bed); }
      else if (bd.kind === 'canopy') { const c = new THREE.Mesh(new THREE.ConeGeometry(bd.r, bd.h * 0.55, 6), white); c.position.y = bd.h * 0.72; c.castShadow = true; g.add(c); for (let k = 0; k < 6; k++) g.add(pipe(V3(Math.cos(k * 1.047) * bd.r * 0.92, 0, Math.sin(k * 1.047) * bd.r * 0.92), V3(Math.cos(k * 1.047) * bd.r * 0.92, bd.h * 0.5, Math.sin(k * 1.047) * bd.r * 0.92), 0.12, roofG)); }
      else if (bd.kind === 'round' || bd.kind === 'tank') { const c = new THREE.Mesh(new THREE.CylinderGeometry(bd.r, bd.r, bd.h, 28), bd.kind === 'tank' ? roofG : white); c.position.y = bd.h / 2; c.castShadow = true; g.add(c); }
      else if (bd.kind === 'yard') B(bd.w, bd.h, bd.d, roofG);
      else { B(bd.w, bd.h, bd.d, white); B(bd.w + 0.06, bd.h * 0.28, bd.d + 0.06, dark, 0, bd.h * 0.36); B(bd.w + 0.7, 0.25, bd.d + 0.7, roofG, 0, bd.h); }
      if (!bd.quiet) this.addLabel(`<b>${bd.name}</b>${bd.zone ? `<i>zone ${bd.zone}</i>` : ''}`, V3(bd.x, (bd.h || 4) + 4, bd.y), 'bld', 'campus');
    }
    const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 40), new THREE.MeshStandardMaterial({ color: 0x4f8ea6, roughness: 0.08, normalMap: this.waterN, envMapIntensity: 1.4 })); pond.rotation.x = -Math.PI / 2; pond.position.set(POND.x, -0.4, POND.y); pond.scale.set(1.25, 0.8, 1);
    site.add(pond, P(POND.x - 36, POND.x + 36, POND.y - 26, POND.y + 26, -0.47, M(0x8fa869))); this.addLabel(`<b>${POND.name}</b>`, V3(POND.x, 6, POND.y), 'bld', 'campus');
    // trees along the roads and the farm frontage
    const spots = [], clear = (x, z) => !(x > -6 && x < 104 && z > -6 && z < 56) && !BUILDINGS.some(d => Math.hypot(x - d.x, z - d.y) < Math.max(d.w || d.r * 2, d.d || d.r * 2) * 0.62 + 3) && !PARKING.some(p => x > p.x0 - 3 && x < p.x1 + 3 && z > p.y0 - 3 && z < p.y1 + 3) && !ROADS.some(([a, c, e, f, w]) => x > Math.min(a, e) - w / 2 - 1 && x < Math.max(a, e) + w / 2 + 1 && z > Math.min(c, f) - w / 2 - 1 && z < Math.max(c, f) + w / 2 + 1);
    for (const [x0, y0, x1, y1, w] of ROADS) { const h = x0 === x1, len = h ? y1 - y0 : x1 - x0; for (let s = 7; s < len; s += 16) for (const o of [-1, 1]) { const x = h ? x0 + o * (w / 2 + 3) : x0 + s, z = h ? y0 + s : y0 + o * (w / 2 + 3); if (clear(x, z)) spots.push([x, z]); } }
    for (let x = 6; x < 100; x += 13) spots.push([x, -5.6]);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 3.2, 6), M(0x6b5338), spots.length), crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.7, 2), M(0x5c7f45, { roughness: 1 }), spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    spots.forEach(([x, z], i) => { const s = 0.75 + rnd(i, 4) * 0.45; m4.compose(V3(x, 1.1 * s, z), q, V3(s, s, s)); trunk.setMatrixAt(i, m4); m4.compose(V3(x, 3.6 * s, z), q.setFromEuler(new THREE.Euler(0, rnd(i, 9) * 6, 0)), V3(s, s * (0.8 + rnd(i, 2) * 0.35), s)); crown.setMatrixAt(i, m4); });
    trunk.castShadow = crown.castShadow = true; site.add(trunk, crown);
  }

  // states: Map(id → { color, level (0–1), sev, text, dim })
  update(states, wtFracs) {
    for (const [id, o] of this.tanks) {
      const s = states.get(id); if (!s) continue;
      o.water.visible = s.level > 0.02; o.water.position.y = L.tankFloor + 0.05 + TANK_SPEC.waterDepth * s.level;
      o.water.material.color.set(s.color); o.halo.visible = s.sev >= 2; o.halo.material.color.set(s.sev >= 3 ? 0xd03b3b : 0xfab219);
      o.sn.material.color.set(s.sev >= 3 ? 0xd03b3b : s.sev === 2 ? 0xfab219 : s.level > 0.02 ? 0x0ca30c : 0x9aa5b1);
      o.label.el.lastChild.textContent = s.text || ''; o.label.el.classList.toggle('alarm', s.sev >= 2); o.label.el.classList.toggle('crit', s.sev >= 3); o.label.el.classList.toggle('off', !!s.dim);
    }
    if (wtFracs) this.wt.forEach((o, i) => { const f = wtFracs[i] ?? 0; o.water.visible = f > 0.01; o.water.scale.y = Math.max(0.02, f * o.w.depth); o.label.el.lastChild.textContent = wtFracs[i] == null ? '' : Math.round(f * 100) + ' %'; });
  }
  select(id) { this.selected = id; for (const [k, o] of this.tanks) { o.sel.visible = k === id; o.label.el.classList.toggle('sel', k === id); } }
  focus(id) { const o = this.tanks.get(id); if (o) this.flyTo(V3(o.t.cx - 16, 22, o.t.cy + 30), V3(o.t.cx, 0.5, o.t.cy)); }
  fit(R, k = 1) { const aspect = (this.w && this.h) ? this.w / this.h : 1.5, vf = THREE.MathUtils.degToRad(this.camera.fov) / 2, hf = Math.atan(Math.tan(vf) * aspect); return R / Math.sin(Math.min(vf, hf)) * k; }
  setView(name, instant) {
    const wide = (this.w || 1200) / (this.h || 800) >= 1.15;
    const V = { campus: [[-0.3, 0.6, 0.74], [-175, 0, 240], this.fit(390, 0.74)], farm: [[-0.62, 0.36, 0.7], [56, 2, 25], this.fit(56, wide ? 0.72 : 0.92) * 1.4],
      inside: [[-0.55, 0.56, 0.62], [50, 0, 25], this.fit(56, wide ? 0.72 : 0.92)], plan: [[0, 1, 0.004], [50, 0, 25], this.fit(54, 0.92)],
      wt: [[0.55, 0.5, 0.67], [92.4, 1, 6.3], this.fit(13, 0.9)], rooms: [[0.62, 0.5, 0.6], [80, 1, 27], this.fit(24, 0.8)] }[name];
    this.view = name; this.dInside = this.fit(56, wide ? 0.72 : 0.92);
    this.roofMode = name === 'farm' || name === 'campus' ? 'on' : name === 'inside' || name === 'plan' || name === 'aisle' || name === 'wt' || name === 'rooms' ? 'off' : this.roofMode;
    if (name === 'aisle') return this.flyTo(V3(0.9, 2.5, 12.35), V3(70, 0.8, 12.35), instant);
    if (!V) return; const dir = V3(...V[0]).normalize(), tgt = V3(...V[1]);
    this.flyTo(tgt.clone().addScaledVector(dir, V[2]), tgt, instant);
  }
  flyTo(pos, target, instant) {
    if (instant) { this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); return; }
    this.fly = { p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: target, k: 0 };
  }
  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.w = w; this.h = h;
  }
  bindPointer() {
    const el = this.renderer.domElement, ray = new THREE.Raycaster(), v = new THREE.Vector2(); let down = null;
    const hit = e => { if (this.roofT > 0.5) return null; const b = el.getBoundingClientRect(); v.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(v, this.camera); const h = ray.intersectObjects(this.pickables, false).find(x => x.object.visible); return h ? h.object.userData.tank : null; };
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; this.userMoved = true; });
    el.addEventListener('wheel', () => { this.roofMode = 'auto'; }, { passive: true });
    el.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const id = hit(e); if (id || this.roofT < 0.5) this.onPick && this.onPick(id); else this.setView('inside'); } down = null; });
    el.addEventListener('pointermove', e => { if (e.buttons) return; const id = hit(e); el.style.cursor = id || this.roofT > 0.5 ? 'pointer' : 'grab'; this.onHover && this.onHover(id, e.clientX, e.clientY); });
    el.addEventListener('pointerleave', () => this.onHover && this.onHover(null));
  }
  frame() {
    if (!this.w) return;
    const nowT = performance.now(), dt = Math.min(0.25, (nowT - (this.lastT || nowT)) / 1000); this.lastT = nowT;
    if (this.fly) { const f = this.fly; f.k = Math.min(1, f.k + dt / 1.5); const e = f.k < 0.5 ? 4 * f.k ** 3 : 1 - Math.pow(-2 * f.k + 2, 3) / 2;
      this.camera.position.lerpVectors(f.p0, f.p1, e); this.controls.target.lerpVectors(f.t0, f.t1, e); if (f.k >= 1) this.fly = null; }
    this.controls.update();
    const dist = this.camera.position.distanceTo(this.controls.target), dI = this.dInside || 150, near = Math.min(6, Math.max(0.3, dist / 70));
    if (Math.abs(near - this.camera.near) > 0.05) { this.camera.near = near; this.camera.updateProjectionMatrix(); }
    const want = this.roofMode === 'on' ? 1 : this.roofMode === 'off' ? 0 : THREE.MathUtils.smoothstep(dist, dI * 1.1, dI * 1.5);
    this.roofT += (want - this.roofT) * Math.min(1, dt * 5); if (Math.abs(want - this.roofT) < 0.004) this.roofT = want;
    const t = this.roofT; for (const m of this.lid) { m.opacity = t; m.visible = t > 0.02; m.depthWrite = t > 0.9; }
    for (const m of this.shell) { m.opacity = 0.1 + 0.9 * t; m.depthWrite = t > 0.9; }
    for (const m of this.roofCasters) m.castShadow = t > 0.6;
    this.waterN.offset.x += dt * 0.035; this.waterN.offset.y += dt * 0.05;
    this.pulse += dt * 3.6; const a = 0.45 + 0.4 * Math.sin(this.pulse); for (const o of this.tanks.values()) if (o.halo.visible) o.halo.material.opacity = a;
    this.renderer.render(this.scene, this.camera);
    const cl = this.overlay.classList; cl.toggle('in', t < 0.45); cl.toggle('far', dist > dI * 1.6 || this.w < 560); cl.toggle('wide', dist > dI * 2.3);
    const p = new THREE.Vector3();
    for (const l of this.labels) {
      if (!l.on) { if (l.shown !== false) { l.el.style.display = 'none'; l.shown = false; } continue; }
      p.copy(l.pos).project(this.camera);
      const vis = p.z < 1 && p.z > -1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.08;
      if (vis !== l.shown) { l.el.style.display = vis ? '' : 'none'; l.shown = vis; }
      if (vis) l.el.style.transform = `translate(-50%,-50%) translate(${((p.x * 0.5 + 0.5) * this.w).toFixed(1)}px,${((-p.y * 0.5 + 0.5) * this.h).toFixed(1)}px)`;
    }
  }
}
