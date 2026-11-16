// twin.js — 3D model of the farm block and water treatment block, built from model.js.
// World axes: X = plan x (grid A→V), Z = plan y (grid 1→7), Y = level in metres.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FARM, TANKS, TANK_SPEC, CORRIDORS, SUMPS, ROOMS, DOORS, WT_TANKS, GRID_X, GRID_Y, BAYS } from './model.js';

const L = FARM.levels;
const C = { ground: 0xe6eaef, slab: 0xd3dae2, corridor: 0xdfe5ec, liner: 0x6e2030, linerIn: 0x8a2c3f, tankFloor: 0x9fa9a3,
  column: 0xe0a93b, pump: 0x2f8f5b, steel: 0x8e99a6, pipe: 0xf4f6f8, panel: 0xf7f9fb, concrete: 0xb9c0c8, roof: 0xc5d2e2, ink: 0x14253a, grate: 0x4d5762, plot: 0xd03b3b };

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
  s.holes.push(rrShape(x0 - inset, y0 - inset, x1 + inset, y1 + inset, r + inset, new THREE.Path()));
  return s;
}
const flat = g => { g.rotateX(-Math.PI / 2); return g; };
function box(x0, x1, z0, z1, y0, y1, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return m;
}
function walls(group, x0, x1, z0, z1, y0, y1, th, mat) {
  group.add(box(x0, x1, z0, z0 + th, y0, y1, mat), box(x0, x1, z1 - th, z1, y0, y1, mat), box(x0, x0 + th, z0, z1, y0, y1, mat), box(x1 - th, x1, z0, z1, y0, y1, mat));
}
function pipe(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a), m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), mat);
  m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m;
}
function vault(x0, x1, z0, z1, eave, crown, n = 20) {
  const c = z1 - z0, s = crown - eave, R = (c * c / 4 + s * s) / (2 * s), cy = crown - R, half = Math.asin(c / 2 / R), zc = (z0 + z1) / 2;
  const pos = [], idx = [];
  for (let v = 0; v <= n; v++) { const th = -half + 2 * half * v / n, y = cy + R * Math.cos(th), z = zc + R * Math.sin(th); pos.push(x0, y, z, x1, y, z); }
  for (let v = 0; v < n; v++) { const a = v * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return { g, R, cy, half, zc };
}

export class Twin {
  constructor(host, { onPick, onHover } = {}) {
    this.host = host; this.onPick = onPick; this.onHover = onHover;
    this.tanks = new Map(); this.labels = []; this.layers = {}; this.selected = null; this.pulse = 0;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.setClearColor(0xeef1f4);
    host.appendChild(r.domElement);
    this.overlay = document.createElement('div'); this.overlay.className = 'twin-labels'; host.appendChild(this.overlay);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 900);
    this.controls = new OrbitControls(this.camera, r.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.09, maxPolarAngle: Math.PI / 2 - 0.02, minDistance: 6, maxDistance: 420, zoomSpeed: 0.8 });
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb4c0cc, 1.25));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-40, 90, 20); this.scene.add(sun);
    this.build();
    new ResizeObserver(() => this.resize()).observe(host); this.resize(); this.setView('iso', true);
    this.bindPointer();
    this.running = true; const loop = () => { if (this.running) this.frame(); requestAnimationFrame(loop); }; loop();
  }
  layer(name) { if (!this.layers[name]) { const g = new THREE.Group(); g.name = name; this.layers[name] = g; this.scene.add(g); } return this.layers[name]; }
  setLayer(name, on) { if (this.layers[name]) this.layers[name].visible = on; for (const l of this.labels) if (l.layer === name) l.on = on; }
  addLabel(text, pos, cls, layer, data) {
    const el = document.createElement(data ? 'button' : 'div'); el.className = 'tl ' + cls; el.innerHTML = text;
    if (data) { el.type = 'button'; el.addEventListener('click', e => { e.stopPropagation(); this.onPick && this.onPick(data.tank); }); }
    this.overlay.appendChild(el); const l = { el, pos, layer, on: true, data }; this.labels.push(l); return l;
  }

  build() {
    const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
    const base = this.layer('base'), eq = this.layer('equipment'), pipes = this.layer('piping'), structure = this.layer('structure'),
      env = this.layer('envelope'), roof = this.layer('roof'), grid = this.layer('grid'), sensors = this.layer('sensors');

    // ground, plot boundary, slabs
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: 0xeef1f4 })); ground.rotation.x = -Math.PI / 2; ground.position.set(50, -0.32, 25); base.add(ground);
    base.add(box(0, 85, 0, 50, -0.3, 0, M(C.slab)), box(FARM.wtBlock.x0, FARM.wtBlock.x0 + 14, FARM.wtBlock.y0, FARM.wtBlock.y0 + 12.15, -0.3, 0.15, M(C.slab)));
    for (const c of CORRIDORS) base.add(box(0.2, 81.5, c.y0 + 0.05, c.y1 - 0.05, 0, 0.012, M(C.corridor)));
    base.add(box(76.6, 81.5, 0.2, 49.8, 0, 0.012, M(C.corridor)));
    const pl = [[-0.2, 0], [99.8, 0], [99.8, 49.5], [-0.2, 49.5], [-0.2, 0]].map(p => new THREE.Vector3(p[0], 0.03, p[1] + 0.25));
    const plot = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pl), new THREE.LineDashedMaterial({ color: C.plot, dashSize: 1.6, gapSize: 0.9 }));
    plot.computeLineDistances(); base.add(plot);

    // tanks
    const linerMat = M(C.liner, { roughness: 0.6 }), floorMat = M(C.tankFloor), pipeMat = M(C.pipe, { roughness: 0.4 });
    for (const t of TANKS) {
      const r = TANK_SPEC.cornerRadius, w = TANK_SPEC.wall, depth = L.tankRim - L.tankFloor;
      const wall = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(ring(t.x0, t.y0, t.x1, t.y1, r, 0, -w), { depth, bevelEnabled: false, curveSegments: 6 })), linerMat);
      wall.position.y = L.tankFloor;
      const inner = () => flat(new THREE.ShapeGeometry(rrShape(t.x0 + w, t.y0 + w, t.x1 - w, t.y1 - w, r - w), 6));
      const floor = new THREE.Mesh(inner(), floorMat); floor.position.y = L.tankFloor + 0.02;
      const water = new THREE.Mesh(inner(), new THREE.MeshStandardMaterial({ color: 0x4f8fa0, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.93 }));
      water.userData.tank = t.id; floor.userData.tank = t.id; wall.userData.tank = t.id;
      const halo = new THREE.Mesh(flat(new THREE.ShapeGeometry(ring(t.x0, t.y0, t.x1, t.y1, r, 0.42), 6)), new THREE.MeshBasicMaterial({ color: 0xd03b3b, transparent: true, opacity: 0.9 }));
      halo.position.y = 0.03; halo.visible = false;
      const sel = new THREE.Mesh(flat(new THREE.ExtrudeGeometry(ring(t.x0, t.y0, t.x1, t.y1, r, 0.16, 0.02), { depth: 0.1, bevelEnabled: false, curveSegments: 6 })), new THREE.MeshBasicMaterial({ color: 0x14253a }));
      sel.position.y = L.tankRim + 0.02; sel.visible = false;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.35, 12), pipeMat); stand.position.set(t.cx, L.tankFloor + 0.67, t.cy);
      base.add(wall, floor, water, halo, sel, stand);
      // treatment column + pump on the corridor side (see renders)
      const col = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.1, 20), M(C.column, { roughness: 0.5 })); body.position.y = 1.05;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.56, 0.75, 20), M(C.column, { roughness: 0.5 })); cone.position.y = 2.47;
      col.add(body, cone); col.position.set(t.column.x, 0, t.column.y); eq.add(col);
      const pump = box(t.pump.x - 0.3, t.pump.x + 0.3, t.pump.y - 0.22, t.pump.y + 0.22, 0, 0.5, M(C.pump)); eq.add(pump);
      const edgeZ = t.side < 0 ? t.y1 : t.y0;
      pipes.add(pipe(new THREE.Vector3(t.column.x, 2.85, t.column.y), new THREE.Vector3(t.column.x, 3.35, t.column.y), 0.06, pipeMat),
        pipe(new THREE.Vector3(t.column.x - 1.6, 1.25, t.column.y), new THREE.Vector3(t.column.x - 1.6, 1.25, edgeZ + t.side * 1.2), 0.07, pipeMat),
        pipe(new THREE.Vector3(t.column.x - 1.6, 1.25, t.column.y), new THREE.Vector3(t.column.x - 0.5, 1.25, t.column.y), 0.07, pipeMat));
      const sn = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: 0x0ca30c }));
      sn.position.set(t.cx - 3.2, 1.55, edgeZ);
      const post = pipe(new THREE.Vector3(t.cx - 3.2, 0.9, edgeZ), new THREE.Vector3(t.cx - 3.2, 1.5, edgeZ), 0.035, M(C.steel)); sensors.add(sn, post);
      const label = this.addLabel(`<b>${t.id}</b><i></i>`, new THREE.Vector3(t.cx, L.tankRim + 0.4, t.cy), 'tank', 'labels', { tank: t.id });
      this.tanks.set(t.id, { t, water, floor, halo, sel, sn, label, pump, col });
    }
    this.pickables = [...this.tanks.values()].flatMap(o => [o.water, o.floor]);

    // floor pits, header pipes
    for (const s of SUMPS) base.add(box(s.x - s.w / 2, s.x + s.w / 2, s.y - s.d / 2, s.y + s.d / 2, 0, 0.03, M(C.grate, { roughness: 0.5, metalness: 0.4 })));
    for (const c of CORRIDORS) { const z = (c.y0 + c.y1) / 2;
      pipes.add(pipe(new THREE.Vector3(1.5, 3.35, z - 0.62), new THREE.Vector3(79, 3.35, z - 0.62), 0.09, pipeMat), pipe(new THREE.Vector3(1.5, 3.35, z + 0.62), new THREE.Vector3(79, 3.35, z + 0.62), 0.09, pipeMat)); }
    pipes.add(pipe(new THREE.Vector3(79, 3.35, 5.5), new THREE.Vector3(79, 3.35, 38), 0.11, pipeMat), pipe(new THREE.Vector3(79, 3.35, 5.5), new THREE.Vector3(92, 3.35, 5.5), 0.11, pipeMat),
      pipe(new THREE.Vector3(92, 3.35, 5.5), new THREE.Vector3(92, 2.3, 5.5), 0.11, pipeMat));

    // service rooms (sandwich panel) and doors
    const panel = M(C.panel, { transparent: true, opacity: 0.72 });
    for (const rm of ROOMS) { walls(env, rm.x0, rm.x1, rm.y0, rm.y1, 0.3, 0.3 + rm.h, 0.08, panel); base.add(box(rm.x0, rm.x1, rm.y0, rm.y1, 0, 0.3, M(0xe9edf2)));
      this.addLabel(rm.name, new THREE.Vector3((rm.x0 + rm.x1) / 2, 0.3 + rm.h + 0.5, (rm.y0 + rm.y1) / 2), 'room', 'labels'); }
    for (const d of DOORS) base.add(box(84.9, 85.15, d.y0, d.y1, 0, 2.6, M(C.ink)));

    // water treatment block
    const conc = M(C.concrete);
    this.wt = WT_TANKS.map(w => {
      walls(base, w.x0 - 0.25, w.x1 + 0.25, w.y0 - 0.25, w.y1 + 0.25, w.floor, w.top, 0.25, conc);
      const water = box(w.x0, w.x1, w.y0, w.y1, 0, 1, new THREE.MeshStandardMaterial({ color: 0x3b8fb5, roughness: 0.2, transparent: true, opacity: 0.9 }));
      water.geometry.translate(0, 0.5, 0); water.position.y = w.floor; base.add(water);
      const label = this.addLabel(`<b>${w.name}</b><i></i>`, new THREE.Vector3((w.x0 + w.x1) / 2, w.top + 0.5, (w.y0 + w.y1) / 2), 'wtl', 'labels');
      return { w, water, label };
    });
    base.add(box(89.3, 93.3, 10.3, 11.4, 0.15, 1.35, M(C.steel, { metalness: 0.5, roughness: 0.5 }))); // access platform shown on A400
    this.addLabel('Water treatment room', new THREE.Vector3(92.4, 0.4, 14.2), 'room', 'labels');

    // envelope
    const skin = new THREE.MeshStandardMaterial({ color: C.panel, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    walls(env, 0, 85, 0, 50, 0, L.eave, 0.2, skin);
    walls(env, FARM.wtBlock.x0, FARM.wtBlock.x0 + 14, FARM.wtBlock.y0, FARM.wtBlock.y0 + 12.15, 0.15, 3.2, 0.2, skin);

    // roof: four barrel vaults with ridge monitors, plus the water treatment vault
    const roofMat = new THREE.MeshStandardMaterial({ color: C.roof, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
    const steelLines = [];
    for (const [z0, z1] of BAYS) {
      const v = vault(0, 85, z0, z1, L.eave, L.crown); roof.add(new THREE.Mesh(v.g, roofMat));
      roof.add(box(2, 83, v.zc - 1, v.zc + 1, L.crown - 0.05, L.monitorTop, roofMat));
      for (const gx of GRID_X) { const n = 12; let prevT = null, prevB = null;
        for (let k = 0; k <= n; k++) { const th = -v.half + 2 * v.half * k / n;
          const T = [gx.x, v.cy + v.R * Math.cos(th), v.zc + v.R * Math.sin(th)], B = [gx.x, v.cy + (v.R - 0.6) * Math.cos(th) - 0.05, v.zc + (v.R - 0.6) * Math.sin(th)];
          if (prevT) steelLines.push(...prevT, ...T, ...prevB, ...B, ...(k % 2 ? [...prevB, ...T] : [...prevT, ...B]));
          prevT = T; prevB = B; } }
    }
    const wv = vault(FARM.wtBlock.x0, FARM.wtBlock.x0 + 14, FARM.wtBlock.y0, FARM.wtBlock.y0 + 12.15, 3.2, 4.9); roof.add(new THREE.Mesh(wv.g, roofMat));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(steelLines, 3));
    structure.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: C.steel, transparent: true, opacity: 0.75 })));
    const colZ = [0.1, 12.5, 25, 37.5, 49.9], cg = new THREE.CylinderGeometry(0.11, 0.11, L.eave, 8);
    const cols = new THREE.InstancedMesh(cg, M(C.steel, { metalness: 0.6, roughness: 0.45 }), GRID_X.length * colZ.length); const m4 = new THREE.Matrix4(); let n = 0;
    for (const gx of GRID_X) for (const z of colZ) { m4.makeTranslation(Math.min(Math.max(gx.x, 0.1), 84.9), L.eave / 2, z); cols.setMatrixAt(n++, m4); }
    structure.add(cols);

    // structural grid
    const gl = [];
    for (const g of GRID_X) { gl.push(g.x, 0.02, -3, g.x, 0.02, 53); this.addLabel(g.name, new THREE.Vector3(g.x, 0.1, -4.2), 'grid', 'grid'); }
    for (const g of GRID_Y) { gl.push(-3, 0.02, g.y, 88, 0.02, g.y); this.addLabel(g.name, new THREE.Vector3(-4.2, 0.1, g.y), 'grid', 'grid'); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
    grid.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x8794a3, transparent: true, opacity: 0.55 })));
  }

  // states: Map(id → { color, level (0–1), sev, text, dim })
  update(states, wtFracs) {
    for (const [id, o] of this.tanks) {
      const s = states.get(id); if (!s) continue;
      o.water.visible = s.level > 0.02; o.water.position.y = L.tankFloor + 0.05 + (TANK_SPEC.waterDepth) * s.level;
      o.water.material.color.set(s.color); o.sev = s.sev; o.halo.visible = s.sev >= 2;
      o.halo.material.color.set(s.sev >= 3 ? 0xd03b3b : 0xfab219);
      o.sn.material.color.set(s.sev >= 3 ? 0xd03b3b : s.sev === 2 ? 0xfab219 : s.level > 0.02 ? 0x0ca30c : 0x9aa5b1);
      o.label.el.lastChild.textContent = s.text || ''; o.label.el.classList.toggle('alarm', s.sev >= 2); o.label.el.classList.toggle('crit', s.sev >= 3);
      o.label.el.classList.toggle('off', !!s.dim);
    }
    if (wtFracs) this.wt.forEach((o, i) => { o.water.scale.y = Math.max(0.02, wtFracs[i] * o.w.depth); o.label.el.lastChild.textContent = Math.round(wtFracs[i] * 100) + ' %'; });
  }
  select(id) {
    this.selected = id;
    for (const [k, o] of this.tanks) { o.sel.visible = k === id; o.label.el.classList.toggle('sel', k === id); }
  }
  focus(id) { const o = this.tanks.get(id); if (o) this.flyTo(new THREE.Vector3(o.t.cx - 14, 20, o.t.cy + 26), new THREE.Vector3(o.t.cx, 0.5, o.t.cy)); }
  setView(name, instant) {
    // [direction from target to camera, target, radius to fit] — distance is solved from the viewport
    const V = { iso: [[-0.55, 0.56, 0.62], [50, 0, 25], 56], plan: [[0, 1, 0.004], [50, 0, 25], 54], aisle: null,
      wt: [[0.55, 0.5, 0.67], [92.4, 1, 6.3], 13], rooms: [[0.62, 0.5, 0.6], [80, 1, 27], 24] }[name];
    this.view = name;
    if (name === 'aisle') return this.flyTo(new THREE.Vector3(0.9, 2.5, 12.35), new THREE.Vector3(70, 0.8, 12.35), instant);
    if (!V) return;
    const aspect = (this.w && this.h) ? this.w / this.h : 1.4, vf = THREE.MathUtils.degToRad(this.camera.fov) / 2, hf = Math.atan(Math.tan(vf) * aspect);
    const d = V[2] / Math.sin(Math.min(vf, hf)) * (name === 'plan' || aspect < 1.15 ? 0.92 : 0.72), dir = new THREE.Vector3(...V[0]).normalize(), tgt = new THREE.Vector3(...V[1]);
    this.flyTo(tgt.clone().addScaledVector(dir, d), tgt, instant);
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
    const hit = e => { const b = el.getBoundingClientRect(); v.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(v, this.camera); const h = ray.intersectObjects(this.pickables, false).find(x => x.object.visible); return h ? h.object.userData.tank : null; };
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) this.onPick && this.onPick(hit(e)); down = null; });
    el.addEventListener('pointermove', e => { if (e.buttons) return; const id = hit(e); el.style.cursor = id ? 'pointer' : 'grab'; this.onHover && this.onHover(id, e.clientX, e.clientY); });
    el.addEventListener('pointerleave', () => this.onHover && this.onHover(null));
  }
  frame() {
    if (!this.w) return;
    if (this.fly) { const f = this.fly; f.k = Math.min(1, f.k + 0.035); const e = 1 - Math.pow(1 - f.k, 3);
      this.camera.position.lerpVectors(f.p0, f.p1, e); this.controls.target.lerpVectors(f.t0, f.t1, e); if (f.k >= 1) this.fly = null; }
    this.controls.update();
    this.pulse += 0.06; const a = 0.45 + 0.4 * Math.sin(this.pulse);
    for (const o of this.tanks.values()) if (o.halo.visible) o.halo.material.opacity = a;
    this.renderer.render(this.scene, this.camera);
    const p = new THREE.Vector3(), dist = this.camera.position.distanceTo(this.controls.target);
    this.overlay.classList.toggle('far', dist > 250 || this.w < 560); this.overlay.classList.toggle('near', dist < 70);
    for (const l of this.labels) {
      if (!l.on) { if (l.shown !== false) { l.el.style.display = 'none'; l.shown = false; } continue; }
      p.copy(l.pos).project(this.camera);
      const vis = p.z < 1 && p.z > -1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.08;
      if (vis !== l.shown) { l.el.style.display = vis ? '' : 'none'; l.shown = vis; }
      if (vis) l.el.style.transform = `translate(-50%,-50%) translate(${((p.x * 0.5 + 0.5) * this.w).toFixed(1)}px,${((-p.y * 0.5 + 0.5) * this.h).toFixed(1)}px)`;
    }
  }
}
