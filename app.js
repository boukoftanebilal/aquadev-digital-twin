// app.js — views, state and the 1-second update loop.
import { FARM, TANKS, ROOMS, WT_TANKS, GRID_X, GRID_Y, CORRIDORS, SUMPS, DRAWINGS, KPI_TARGETS, KEY_FIGURES, LIMITS, DENSITY_LIMIT, ASSUMPTIONS, TANK_SPEC } from './model.js';
import * as S from './sim.js';
import { lineChart, barChart, spark, initHover, showTip, num, esc, fmtTime, fmtDate, fmtDateTime } from './charts.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = { get(k, d) { try { const v = localStorage.getItem('aquadev.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('aquadev.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } } };
const HOUR = S.HOUR, DAY = S.DAY;
const state = { view: 'twin', sel: null, colorBy: 'status', speed: 1, simT: Date.now(), last: Date.now(), param: 'do', hoverChart: false, acks: new Set(),
  layers: { labels: true, equipment: true, piping: true, sensors: true, structure: false, envelope: true, roof: false, grid: false }, sort: 'id', poll: null, source: 'Simulator' };
const savedStart = store.get('start', null); if (savedStart) S.CFG.start = savedStart;
let twin = null, kpiCache = null;

// ---- colour -------------------------------------------------------------------------
const hex2 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hex2(a), B = hex2(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const SEQ = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const seq = t => { t = Math.min(1, Math.max(0, t)) * (SEQ.length - 1); const i = Math.min(SEQ.length - 2, Math.floor(t)); return mix(SEQ[i], SEQ[i + 1], t - i); };
const DIV = { lo: '#2a78d6', mid: '#cdd4da', hi: '#d03b3b' };
const STATUS = { ok: '#3f8fa3', warn: '#fab219', crit: '#d03b3b', fill: '#a9cfdd', good: '#0ca30c' };
const SEVC = ['#0ca30c', '#8a97a5', '#fab219', '#d03b3b'];
function divColor(p, v) { const L = LIMITS[p]; if (v >= L.t0 && v <= L.t1) return DIV.mid; return v < L.t0 ? mix(DIV.mid, DIV.lo, Math.min(1, (L.t0 - v) / (L.t0 - Math.max(L.lo2, L.min)))) : mix(DIV.mid, DIV.hi, Math.min(1, (v - L.t1) / (L.hi2 - L.t1))); }
const MODES = {
  status:  { label: 'Alarm status', kind: 'status' },
  doc:     { label: 'Day of culture', kind: 'seq', max: S.CFG.growDays, unit: 'd', dp: 0, get: r => r.st.stocked ? r.st.doc : null },
  weight:  { label: 'Average weight', kind: 'seq', max: 28, unit: 'g', dp: 1, get: r => r.st.stocked ? r.st.weight : null },
  biomass: { label: 'Standing biomass', kind: 'seq', max: 750, unit: 'kg', dp: 0, get: r => r.st.stocked ? r.st.biomass : null },
  density: { label: 'Stocking density', kind: 'seq', max: 8, unit: 'kg/m²', dp: 2, get: r => r.st.stocked ? r.st.density : null },
  do:      { label: 'Dissolved oxygen', kind: 'div', param: 'do' }, temp: { label: 'Water temperature', kind: 'div', param: 'temp' },
  ph:      { label: 'pH', kind: 'div', param: 'ph' }, tan: { label: 'Total ammonia N', kind: 'div', param: 'tan' },
};

// ---- derived per-tick snapshot ------------------------------------------------------
function snapshot(t) {
  const tanks = new Map(); for (const tk of TANKS) { const { sev, r } = S.tankSeverity(tk.id, t); tanks.set(tk.id, { tk, r, st: r.st, sev }); }
  return { t, tanks, farm: S.farm(t), alarms: S.alarmsAt(t), wt: S.wtState(t) };
}
function tankVisual(x) {
  const m = MODES[state.colorBy], r = x.r, st = x.st; let color = STATUS.ok, text = '';
  const level = r.wet ? Math.max(0, Math.min(1, r.level)) : 0;
  if (m.kind === 'status') { color = !st.stocked ? STATUS.fill : x.sev >= 3 ? STATUS.crit : x.sev === 2 ? STATUS.warn : STATUS.ok;
    text = st.stocked ? `day ${Math.floor(st.doc)}` : { idle: 'not stocked', harvest: 'harvest', clean: 'drained', fill: 'filling' }[st.phase]; }
  else if (m.kind === 'seq') { const v = m.get(r); color = v == null ? '#c9d1d9' : seq(v / m.max); text = v == null ? '—' : num(v, m.dp) + ' ' + m.unit; }
  else { const v = r.wet && st.stocked ? r[m.param] : null; color = v == null ? '#c9d1d9' : divColor(m.param, v); text = v == null ? '—' : num(v, LIMITS[m.param].dp) + (LIMITS[m.param].unit ? ' ' + LIMITS[m.param].unit : ''); }
  return { color, level, sev: x.sev, text, dim: !st.stocked };
}
function legendHtml() {
  const m = MODES[state.colorBy];
  if (m.kind === 'status') return `<ul class="lg-list"><li><i style="background:${STATUS.ok}"></i>Grow-out, in range</li><li><i style="background:${STATUS.warn}"></i>Warning</li><li><i style="background:${STATUS.crit}"></i>Critical</li><li><i style="background:${STATUS.fill}"></i>Filling or harvesting</li><li><i class="hollow"></i>Drained</li></ul>`;
  if (m.kind === 'seq') return `<div class="lg-bar" style="background:linear-gradient(90deg,${SEQ.join(',')})"></div><div class="lg-ax"><span>0</span><span>${num(m.max / 2, 0)}</span><span>${num(m.max, 0)} ${m.unit}</span></div>`;
  const L = LIMITS[m.param];
  return `<div class="lg-bar" style="background:linear-gradient(90deg,${DIV.lo},${DIV.mid} 40%,${DIV.mid} 60%,${DIV.hi})"></div><div class="lg-ax"><span>low</span><span>target ${L.t0}–${L.t1} ${L.unit}</span><span>high</span></div>`;
}

// ---- shared fragments ---------------------------------------------------------------
const chip = (sev, text) => `<span class="chip s${sev}"><i></i>${esc(text)}</span>`;
const phaseChip = x => x.st.stocked ? chip(x.sev === 0 ? 0 : x.sev, x.sev >= 2 ? S.SEV[x.sev] : 'Grow-out') : `<span class="chip sx" title="${esc(x.st.label)}"><i></i>${esc(x.st.short)}</span>`;
function rangeBar(p, v) {
  const L = LIMITS[p], pos = x => Math.min(100, Math.max(0, (x - L.min) / (L.max - L.min) * 100));
  const seg = (a, b, c) => b > a ? `<span class="${c}" style="left:${pos(a)}%;width:${pos(b) - pos(a)}%"></span>` : '';
  return `<div class="rb">${seg(L.min, Math.max(L.min, L.lo2), 'c')}${seg(Math.max(L.min, L.lo2), Math.max(L.min, L.lo1), 'w')}${seg(L.t0, L.t1, 'g')}${seg(L.hi1, L.hi2, 'w')}${seg(L.hi2, L.max, 'c')}<b style="left:${pos(v)}%"></b></div>`;
}
function stat(label, value, sub = '') { return `<div class="stat"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`; }
const assumed = `<abbr class="as" title="Assumed — not stated in the supplied documents">assumed</abbr>`;

function planSvg(snap, { h = 360, labels = true } = {}) {
  let g = `<rect class="slab" x="0" y="0" width="85" height="50"/><rect class="slab" x="${FARM.wtBlock.x0}" y="${FARM.wtBlock.y0}" width="14" height="12.15"/>`;
  for (const c of CORRIDORS) g += `<rect class="corr" x="0.2" y="${c.y0}" width="81.3" height="${c.y1 - c.y0}"/>`;
  for (const s of SUMPS) g += `<rect class="sump" x="${s.x - 1}" y="${s.y - 0.75}" width="2" height="1.5"/>`;
  for (const r of ROOMS) g += `<rect class="room" x="${r.x0}" y="${r.y0}" width="${r.x1 - r.x0}" height="${r.y1 - r.y0}" data-tip="${esc(r.name)}${r.note ? ' — ' + esc(r.note) : ''}"/>`;
  for (const w of WT_TANKS) g += `<rect class="wtt" x="${w.x0}" y="${w.y0}" width="${w.x1 - w.x0}" height="${w.y1 - w.y0}" data-tip="${esc(w.name)} — ${num(w.volume, 0)} m³ gross"/>`;
  for (const tk of TANKS) { const x = snap.tanks.get(tk.id), v = tankVisual(x);
    g += `<g class="pt${state.sel === tk.id ? ' sel' : ''}" data-tank="${tk.id}" data-tip="<b>${tk.name}</b> — ${esc(x.st.label)}<br>${esc(v.text)}"><rect x="${tk.x0}" y="${tk.y0}" width="${tk.x1 - tk.x0}" height="${tk.y1 - tk.y0}" rx="${TANK_SPEC.cornerRadius}" fill="${v.level > 0.02 ? v.color : '#eef1f4'}"/>${labels ? `<text x="${tk.cx}" y="${tk.cy + 1.3}">${tk.id}</text>` : ''}</g>`; }
  if (labels) { for (const gx of GRID_X) g += `<text class="gl" x="${gx.x}" y="-1.4">${gx.name}</text>`; for (const gy of GRID_Y) g += `<text class="gl" x="-2" y="${gy.y + 0.8}">${gy.name}</text>`; }
  return `<svg class="plan" viewBox="-4 -4 106 57" style="height:${h}px" role="img" aria-label="Plan of the farm block">${g}</svg>`;
}

// ---- inspector ----------------------------------------------------------------------
const PARAMS = ['do', 'temp', 'ph', 'sal', 'tan', 'no2', 'alk', 'level'];
function inspectorHtml(snap) {
  const t = snap.t;
  if (!state.sel) { const f = snap.farm, crit = snap.alarms.filter(a => a.sev >= 3).length;
    return `<header><h2>Grow-out hall</h2><p>28 tanks of 100 m² on a ${FARM.block.w} × ${FARM.block.d} m slab. Select a tank in the model to inspect it.</p></header>
      <div class="stats two">${stat('Tanks in grow-out', f.grow + ' of 28')}${stat('Shrimp in water', num(f.count / 1e6, 2) + ' M')}${stat('Standing biomass', num(f.biomass / 1000, 2) + ' t')}${stat('Feed, last 24 h', num(f.feed, 0) + ' kg')}
      ${stat('Electrical load', num(f.power.total, 0) + ' kW')}${stat('Hall air', num(f.climate.room, 1) + ' °C', num(f.climate.rh * 100, 0) + ' % RH')}</div>
      <h3>Next harvests</h3><table class="mini"><tbody>${[...snap.tanks.values()].filter(x => x.st.stocked).sort((a, b) => a.st.harvestAt - b.st.harvestAt).slice(0, 6).map(x => `<tr data-tank="${x.tk.id}"><td>${x.tk.name}</td><td>${fmtDate(x.st.harvestAt)}</td><td class="r">${num(x.st.daysToHarvest, 0)} d</td><td class="r">${num(x.st.projHarvestKg, 0)} kg</td></tr>`).join('')}</tbody></table>
      <h3>Active alarms</h3>${snap.alarms.length ? `<ul class="alist">${snap.alarms.slice(0, 6).map(a => `<li data-tank="${a.tank}">${chip(a.sev, 'Tank ' + a.tank)}<span>${esc(a.text)}</span></li>`).join('')}</ul>` : `<p class="quiet">None. ${crit ? '' : 'All stocked tanks are inside their warning limits.'}</p>`}`; }
  const x = snap.tanks.get(state.sel), tk = x.tk, st = x.st, r = x.r, L = LIMITS[state.param];
  let body = '';
  if (st.stocked) {
    const prog = st.doc / S.CFG.growDays * 100, gs = S.growthSeries(tk.id, t);
    body += `<div class="prog"><div style="width:${prog}%"></div></div><p class="progl"><span>Cycle ${st.cycle}, day ${Math.floor(st.doc)} of ${S.CFG.growDays}</span><span>Harvest ${fmtDate(st.harvestAt)}</span></p>
      <div class="stats two">${stat('Average weight', num(st.weight, 1) + ' g', num(st.growthNow, 2) + ' g/week')}${stat('Population', num(st.count, 0), num(st.survival * 100, 1) + ' % survival')}
      ${stat('Biomass', num(st.biomass, 0) + ' kg', num(st.density, 2) + ' kg/m²')}${stat('Feed, last 24 h', num(st.feedToday, 1) + ' kg', num(st.feedRate * 100, 1) + ' % of biomass')}
      ${stat('Feed this cycle', num(st.feedCum, 0) + ' kg', 'FCR to date ' + num(st.fcrToDate, 2))}${stat('Projected harvest', num(st.projHarvestKg, 0) + ' kg', num(st.projDensity, 2) + ' kg/m²' + (st.projDensity > DENSITY_LIMIT ? ' — over limit' : ''))}</div>
      <h3>Water quality</h3><table class="wq"><tbody>${PARAMS.map(p => { const sv = S.severity(p, r[p]); return `<tr class="${state.param === p ? 'on' : ''}" data-param="${p}"><td>${LIMITS[p].label}${r.measured[p] ? ' <abbr class="ms" title="Measured value from the connected feed">measured</abbr>' : ''}</td><td class="r"><b>${num(r[p], LIMITS[p].dp)}</b> ${LIMITS[p].unit.replace(' CaCO₃', '')}</td><td>${rangeBar(p, r[p])}</td><td>${sv >= 2 ? `<span class="flag f${sv}" title="${S.SEV[sv]}">${sv === 3 ? '×' : '!'}</span>` : ''}</td></tr>`; }).join('')}</tbody></table>
      <h3>${L.label}, last 24 hours</h3>${lineChart({ title: L.label, series: [{ name: L.label, color: '#2a78d6', pts: S.series(tk.id, state.param, t - DAY, t) }], time: true, unit: L.unit, dp: L.dp, w: 338, h: 170,
        bands: [{ from: L.t0, to: L.t1, cls: 'ok' }], rules: [L.lo1 > L.min ? { y: L.lo1, label: 'low warning' } : null, { y: L.hi1, label: 'high warning' }].filter(q => q && Math.abs(q.y - r[state.param]) < (L.max - L.min) * 0.35) })}
      <h3>Growth against the 1.7 g/week target</h3>${lineChart({ title: 'Growth', series: [{ name: 'Target', color: '#8a97a5', pts: gs.target, dash: true }, { name: 'This cycle', color: '#2a78d6', pts: gs.actual }], xLabel: 'Day', unit: 'g', dp: 1, w: 338, h: 170, zero: true })}`;
  } else {
    body += `<p class="phase-note">${esc(st.label)}.${st.phase === 'idle' ? ` First stocking in ${num(st.daysToStock, 0)} days.` : ` Next stocking ${fmtDate(st.nextStockAt)}.`}${st.lastHarvestKg ? ` Last harvest ${num(st.lastHarvestKg, 0)} kg at ${num(S.CFG.w0 + st.p.g * S.CFG.growDays / 7, 1)} g, survival ${num(st.p.S * 100, 0)} %, FCR ${num(st.p.fcr, 2)}.` : ''}</p>
      ${r.wet ? `<div class="stats two">${stat('Water depth', num(r.level, 2) + ' m')}${stat('Temperature', num(r.temp, 1) + ' °C')}${stat('Salinity', num(r.sal, 1) + ' ppt')}${stat('pH', num(r.ph, 2))}</div>` : ''}`;
  }
  const eqRow = (n, ok, d) => `<tr><td>${n}</td><td>${chip(ok ? 0 : 3, ok ? 'Running' : 'Stopped')}</td><td class="r">${d}</td></tr>`;
  body += `<h3>Equipment ${assumed}</h3><table class="mini"><tbody>${eqRow('Circulation pump P-' + tk.id, r.wet && r.pump, r.wet ? num(r.flow, 0) + ' m³/h' : '—')}${eqRow('Treatment column TC-' + tk.id, r.wet && r.pump, '')}${eqRow('Aeration', r.wet && r.aeration !== false, '')}
    <tr><td>Feeder hopper</td><td>${st.stocked ? chip(r.hopper < 25 ? 2 : 0, r.hopper < 25 ? 'Refill' : 'OK') : chip(1, 'Idle')}</td><td class="r">${st.stocked ? num(r.hopper, 0) + ' %' : '—'}</td></tr></tbody></table>
    <div class="row"><button class="btn" data-act="focus">Zoom to tank</button><button class="btn ghost" data-act="fault" title="Starts a 90-minute aeration fault in the simulator so you can test the alarm path">Test an aeration alarm</button></div>`;
  return `<header><button class="x" data-act="close" aria-label="Close tank panel">×</button><h2>${tk.name}</h2><p>${tk.tag}, grid ${tk.grid}, ${TANK_SPEC.footprint} m², centre drain Ø${TANK_SPEC.drainDia} m</p>${phaseChip(x)}</header>${body}`;
}

// ---- views --------------------------------------------------------------------------
const V = {};
V.twin = {
  title: 'Digital twin',
  tick(snap, full) {
    if (twin) { const m = new Map(); for (const [id, x] of snap.tanks) m.set(id, tankVisual(x)); twin.update(m, snap.wt.tanks.map(w => w.frac)); }
    else if (full) $('#twin-host').innerHTML = `<div class="fallback"><p>3D view is unavailable in this browser (WebGL could not start). Showing the plan instead.</p>${planSvg(snap, { h: 520 })}</div>`;
    const f = snap.farm, crit = snap.alarms.filter(a => a.sev >= 3).length;
    $('#ribbon').innerHTML = stat('Standing biomass', num(f.biomass / 1000, 2) + ' t') + stat('In grow-out', f.grow + ' of 28') + stat('Feed, last 24 h', num(f.feed, 0) + ' kg') + stat('Load', num(f.power.total, 0) + ' kW')
      + stat('Next harvest', f.next ? 'Tank ' + f.next.tank : '—', f.next ? fmtDate(f.next.at) + ', ' + num(f.next.kg, 0) + ' kg' : '') + stat('Alarms', String(snap.alarms.length), crit ? crit + ' critical' : 'none critical');
    if (full) { $('#inspector').innerHTML = inspectorHtml(snap); $('#legend').innerHTML = legendHtml(); }
  },
};
V.tanks = {
  title: 'Tanks',
  tick(snap, full) {
    if (!full) return;
    const cols = [['id', 'Tank'], ['status', 'Status'], ['doc', 'Day'], ['weight', 'Weight, g'], ['count', 'Population'], ['biomass', 'Biomass, kg'], ['density', 'kg/m²'], ['do', 'DO, mg/L'], ['temp', 'Temp, °C'], ['ph', 'pH'], ['tan', 'TAN, mg/L'], ['feed', 'Feed 24 h, kg'], ['harvest', 'Harvest']];
    const val = (x, k) => ({ id: x.tk.id, status: -x.sev * 100 + (x.st.stocked ? 0 : 50), doc: x.st.doc ?? -1, weight: x.st.weight, count: x.st.count, biomass: x.st.biomass, density: x.st.density, do: x.r.do ?? 99, temp: x.r.temp ?? 0, ph: x.r.ph ?? 0, tan: x.r.tan ?? 0, feed: x.st.feedToday, harvest: x.st.stocked ? x.st.harvestAt : 9e15 }[k]);
    const rows = [...snap.tanks.values()].sort((a, b) => val(a, state.sort) - val(b, state.sort));
    const cell = (x, p) => { if (!x.r.wet || !x.st.stocked) return '<td class="r q">—</td>'; const sv = S.severity(p, x.r[p]); return `<td class="r${sv >= 2 ? ' sv' + sv : ''}">${num(x.r[p], LIMITS[p].dp)}</td>`; };
    $('#v-tanks').innerHTML = `<div class="split"><div class="card grow"><div class="card-h"><h2>All grow-out tanks</h2><p>Click a row to open the tank. Click a column heading to sort.</p></div><div class="scroll"><table class="grid-t"><thead><tr>${cols.map(c => `<th data-sort="${c[0]}" class="${state.sort === c[0] ? 'on' : ''}">${c[1]}</th>`).join('')}<th>DO, 6 h</th></tr></thead><tbody>
      ${rows.map(x => `<tr data-tank="${x.tk.id}" class="${state.sel === x.tk.id ? 'on' : ''}"><td><b>${x.tk.name}</b></td><td>${phaseChip(x)}</td>${x.st.stocked ? `<td class="r">${Math.floor(x.st.doc)}</td><td class="r">${num(x.st.weight, 1)}</td><td class="r">${num(x.st.count, 0)}</td><td class="r">${num(x.st.biomass, 0)}</td><td class="r${x.st.density > DENSITY_LIMIT ? ' sv2' : ''}">${num(x.st.density, 2)}</td>` : '<td class="r q">—</td>'.repeat(5)}
        ${cell(x, 'do')}${cell(x, 'temp')}${cell(x, 'ph')}${cell(x, 'tan')}<td class="r">${x.st.stocked ? num(x.st.feedToday, 1) : '<span class="q">—</span>'}</td><td>${x.st.stocked ? fmtDate(x.st.harvestAt) : '<span class="q">' + (x.st.nextStockAt ? 'stock ' + fmtDate(x.st.nextStockAt) : '—') + '</span>'}</td><td>${x.st.stocked ? spark(S.series(x.tk.id, 'do', snap.t - 6 * HOUR, snap.t, 36)) : ''}</td></tr>`).join('')}</tbody></table></div></div>
      <aside class="card side" id="tank-side">${inspectorHtml(snap)}</aside></div>`;
  },
};
V.water = {
  title: 'Water',
  tick(snap, full) {
    if (!full) return; const w = snap.wt, ps = ['do', 'temp', 'ph', 'sal', 'tan', 'no2', 'alk'];
    const stocked = [...snap.tanks.values()].filter(x => x.st.stocked), bad = stocked.filter(x => x.sev >= 2).length;
    const tankSvg = (t, x) => `<g transform="translate(${x},30)"><rect class="wt-wall" width="150" height="130"/><rect class="wt-water" y="${130 - 130 * t.frac}" width="150" height="${130 * t.frac}"/><text class="wt-n" x="75" y="-10">${t.name}</text><text class="wt-v" x="75" y="${Math.max(24, 130 - 130 * t.frac + 24)}">${num(t.frac * 100, 0)} %</text><text class="wt-s" x="75" y="150">${num(t.m3, 0)} of ${num(t.volume, 0)} m³</text><text class="wt-s" x="75" y="166">${esc(t.role)}</text></g>`;
    const unit = (x, n, v) => `<g transform="translate(${x},70)"><rect class="wt-unit" width="92" height="50" rx="6"/><text class="wt-n" x="46" y="21">${n}</text><text class="wt-s" x="46" y="38">${v}</text></g>`;
    $('#v-water').innerHTML = `<div class="cards"><div class="card wide"><div class="card-h"><h2>Water treatment block</h2><p>Two 4.95 × 8.25 m tanks, floor −0.30 m, wall top +2.20 m (drawing A400). Process duties ${assumed}.</p></div>
      <svg class="wt" viewBox="0 0 872 210" role="img" aria-label="Water treatment schematic">${tankSvg(w.tanks[0], 20)}<path class="flow" d="M170 95H216"/>${unit(216, 'Filtration', 'Δp ' + num(w.filterDp, 2) + ' bar')}<path class="flow" d="M308 95H346"/>${unit(346, 'UV', w.uv ? 'on' : 'off')}<path class="flow" d="M438 95H480"/>${tankSvg(w.tanks[1], 480)}<path class="flow" d="M630 95H680"/>
        <g transform="translate(680,56)"><rect class="wt-unit" width="172" height="78" rx="6"/><text class="wt-n" x="86" y="24">Grow-out hall header</text><text class="wt-v2" x="86" y="48">${num(w.demand, 1)} m³/h</text><text class="wt-s" x="86" y="66">make-up and tank filling</text></g></svg>
      <div class="stats four">${stat('Transfer rate', num(w.transfer, 1) + ' m³/h')}${stat('Tanks being filled', String([...snap.tanks.values()].filter(x => x.st.phase === 'fill' && x.r.level < 0.99).length))}${stat('Water in grow-out', num(stocked.length * 100 + [...snap.tanks.values()].filter(x => !x.st.stocked && x.r.wet).reduce((s, x) => s + x.r.level * 100, 0), 0) + ' m³')}${stat('Production water quality', bad ? 'No' : 'Yes', bad ? bad + ' tanks outside limits' : 'all stocked tanks inside limits')}</div></div>
      <div class="card wide"><div class="card-h"><h2>Water quality by tank</h2><p>Current reading in every stocked tank. Cells marked ! are past a warning limit, × past a critical limit.</p></div>
      <div class="scroll"><table class="heat"><thead><tr><th></th>${TANKS.map(t => `<th>${t.id}</th>`).join('')}</tr></thead><tbody>${ps.map(p => `<tr><th>${LIMITS[p].label}<small>${LIMITS[p].unit}</small></th>${TANKS.map(tk => { const x = snap.tanks.get(tk.id); if (!x.st.stocked || !x.r.wet) return '<td class="na" data-tip="' + tk.name + ' — ' + esc(x.st.label) + '"></td>'; const v = x.r[p], sv = S.severity(p, v);
        return `<td class="h${sv}" data-tank="${tk.id}" data-tip="<b>${tk.name}</b> — ${LIMITS[p].label} ${num(v, LIMITS[p].dp)} ${LIMITS[p].unit}<br>${S.SEV[sv]}">${sv === 3 ? '× ' : sv === 2 ? '! ' : ''}${num(v, p === 'alk' || p === 'sal' ? 0 : p === 'temp' || p === 'do' ? 1 : 2)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <ul class="lg-list inline"><li><i class="h0"></i>In target band</li><li><i class="h1"></i>Off target</li><li><i class="h2"></i>Warning !</li><li><i class="h3"></i>Critical ×</li><li><i class="hollow"></i>Not stocked</li></ul></div>
      <div class="card wide"><div class="card-h"><h2>Alarm limits</h2><p>The KPI workbook points to a contract list for water quality; these defaults stand in until it is supplied.</p></div>
      <table class="grid-t"><thead><tr><th>Parameter</th><th>Critical low</th><th>Warning low</th><th>Target band</th><th>Warning high</th><th>Critical high</th><th>Basis</th></tr></thead><tbody>${Object.entries(LIMITS).map(([k, l]) => `<tr><td>${l.label}${l.unit ? ', ' + l.unit : ''}</td><td class="r">${l.lo2 > l.min ? l.lo2 : '—'}</td><td class="r">${l.lo1 > l.min ? l.lo1 : '—'}</td><td class="r">${l.t0}–${l.t1}</td><td class="r">${l.hi1}</td><td class="r">${l.hi2}</td><td>${l.assumed ? 'Typical P. vannamei value' : 'KPI workbook target 30 °C'}</td></tr>`).join('')}</tbody></table></div></div>`;
  },
};
function kpis(t) { const key = Math.floor(t / (10 * 60000)) + ':' + S.CFG.start; if (!kpiCache || kpiCache.key !== key) kpiCache = { key, months: S.monthlyKpis(t) }; return kpiCache.months; }
function agg(months, k) {
  const d = KPI_TARGETS[k], done = months.filter(m => !m.future), vals = done.map(m => m[k]).filter(v => v != null);
  if (k === 'perTank') { const h = agg(months, 'harvest'), n = agg(months, 'tanks'); return n ? h / n : null; }
  if (k === 'cyclesTank') { const c = agg(months, 'cycles'), n = agg(months, 'tanks'); return n ? c / n : null; }
  if (!vals.length) return null;
  return d.agg === 'sum' ? vals.reduce((a, b) => a + b, 0) : d.agg === 'max' ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
}
const kfmt = (k, v) => v == null ? '—' : KPI_TARGETS[k].pct ? num(v * 100, 0) + ' %' : num(v, ['size', 'density', 'growth', 'price', 'waterTemp', 'roomTemp', 'cyclesTank'].includes(k) ? (k === 'growth' || k === 'density' ? 2 : 1) : 0);
V.production = {
  title: 'Production and KPIs',
  tick(snap, full) {
    if (!full) return; const months = kpis(snap.t), done = months.filter(m => !m.future), cur = done.length;
    const H = agg(months, 'harvest') || 0, F = agg(months, 'feed') || 0, E = (agg(months, 'elecProd') || 0) + (agg(months, 'elecOther') || 0), n = agg(months, 'tanks') || 28, R = agg(months, 'revenue') || 0;
    const judge = (k, v) => { const d = KPI_TARGETS[k]; if (v == null || d.agg === 'sum' || k === 'tanks' || k === 'perTank' || k === 'cyclesTank' || k === 'price') return d.agg === 'sum' && d.first ? `<div class="pbar" data-tip="${num(v / d.first * 100, 0)} % of the first-year target"><div style="width:${Math.min(100, v / d.first * 100)}%"></div></div>` : '';
      const over = v > d.first * 1.005; return d.limit === 'max' ? chip(over ? 2 : 0, over ? 'Above limit' : 'Within limit') : chip(v >= d.first * 0.97 ? 0 : 2, v >= d.first * 0.97 ? 'On target' : 'Below target'); };
    const cyc = S.cyclesBetween(S.CFG.start, S.addMonths(S.CFG.start, 12)), t0 = S.CFG.start, t1 = S.addMonths(S.CFG.start, 12), gx = t => 34 + (t - t0) / (t1 - t0) * 760;
    let gantt = ''; for (let m = 0; m <= 12; m++) { const x = gx(S.addMonths(t0, m)); gantt += `<line class="grid" x1="${x}" x2="${x}" y1="14" y2="${14 + 28 * 11}"/>${m < 12 ? `<text class="tick" x="${x + 3}" y="10">M${m + 1}</text>` : ''}`; }
    for (const tk of TANKS) gantt += `<text class="tick" x="28" y="${14 + (tk.id - 1) * 11 + 8}" text-anchor="end">${tk.id}</text>`;
    for (const c of cyc) { const y = 15 + (c.tank - 1) * 11, a = gx(c.t0), b = gx(Math.min(c.tH, t1)); if (a < 794) gantt += `<rect class="gc${c.tH < snap.t ? ' done' : c.t0 < snap.t ? ' live' : ''}" x="${a.toFixed(1)}" y="${y}" width="${Math.max(1, b - a - 1).toFixed(1)}" height="8" rx="2" data-tank="${c.tank}" data-tip="<b>Tank ${c.tank}, cycle ${c.k}</b><br>Stocked ${fmtDate(c.t0)}, harvest ${fmtDate(c.tH)}<br>${c.tH < snap.t ? 'Harvested' : 'Projected'} ${num(c.kg, 0)} kg at ${num(c.size, 1)} g"/>`; }
    if (snap.t > t0 && snap.t < t1) gantt += `<line class="now" x1="${gx(snap.t)}" x2="${gx(snap.t)}" y1="12" y2="${16 + 28 * 11}"/>`;
    $('#v-production').innerHTML = `<div class="cards"><div class="card wide"><div class="card-h"><h2>Key figures, first year to date</h2><p>Month ${cur} of 12 since operations started on ${fmtDate(S.CFG.start)}. Targets are the full-capacity column of the KPI workbook.</p></div>
      <div class="stats six">${stat('Harvest', num(H, 0) + ' kg', 'target ' + num(KPI_TARGETS.harvest.first, 0) + ' kg first year')}${stat('Revenue per kg', H ? 'USD ' + num(R / H, 2) : '—', 'target USD 10.00')}${stat('Production index', num(H / (n * 100), 2) + ' kg/m²', 'target ' + num(KEY_FIGURES.prodIndex, 2) + ' at full capacity')}
        ${stat('eFCR', H ? num(F / H, 2) : '—', 'target ' + num(KEY_FIGURES.fcr, 2) + '; includes feed in standing stock')}${stat('Electricity per kg', H ? num(E / H, 1) + ' kWh' : '—', 'target ' + num(KEY_FIGURES.kwhPerKg, 1) + ' kWh')}${stat('Pilot footprint', num(n * 100, 0) + ' m²', n + ' tanks × 100 m²')}</div></div>
      <div class="card"><div class="card-h"><h2>Monthly harvest</h2><p>Bars are harvested kg; the tick is one twelfth of the full-capacity target (4,284 kg).</p></div>${barChart({ title: 'Monthly harvest', unit: 'kg', bars: months.map(m => ({ label: 'M' + m.m, value: m.future ? 0 : m.harvest, target: 51408 / 12, muted: m.partial, tip: m.future ? `Month ${m.m} — not reached` : `<b>Month ${m.m}${m.partial ? ' (to date)' : ''}</b><br>${num(m.harvest, 0)} kg from ${m.cycles} cycles` })) })}</div>
      <div class="card"><div class="card-h"><h2>Feed by month</h2><p>The tick is one twelfth of the full-capacity feed budget (7,283 kg).</p></div>${barChart({ title: 'Monthly feed', unit: 'kg', color: '#1baf7a', bars: months.map(m => ({ label: 'M' + m.m, value: m.future ? 0 : m.feed, target: 87394 / 12, muted: m.partial, tip: m.future ? '' : `<b>Month ${m.m}</b><br>Feed ${num(m.feed, 0)} kg<br>Electricity ${num(m.elecProd + m.elecOther, 0)} kWh` })) })}</div>
      <div class="card wide"><div class="card-h"><h2>Production cycles, tank by tank</h2><p>One bar per grow-out cycle of ${S.CFG.growDays} days; gaps are harvest, cleaning and refill. The vertical line is the twin clock.</p></div><svg class="gantt" viewBox="0 0 800 ${24 + 28 * 11}" role="img" aria-label="Production cycle schedule">${gantt}</svg></div>
      <div class="card wide"><div class="card-h"><h2>Monthly KPI follow-up</h2><p>Same rows as the workbook sheet “KPIs”. <button class="btn sm" data-act="export">Download as CSV</button></p></div><div class="scroll"><table class="grid-t kpi"><thead><tr><th>KPI</th><th>First-year target</th><th>Full capacity</th><th>Realised to date</th><th></th>${months.map(m => `<th class="${m.partial ? 'part' : ''}">M${m.m}</th>`).join('')}</tr></thead><tbody>
        ${Object.keys(KPI_TARGETS).map(k => { const d = KPI_TARGETS[k], v = agg(months, k); return `<tr><td>${d.label}<small>${d.unit}</small></td><td class="r">${kfmt(k, d.first)}</td><td class="r">${kfmt(k, d.full)}</td><td class="r"><b>${kfmt(k, v)}</b></td><td>${judge(k, v)}</td>${months.map(m => `<td class="r${m.future ? ' q' : ''}">${m.future || m[k] == null ? (k === 'perTank' && !m.future ? num(m.harvest / m.tanks, 0) : k === 'cyclesTank' && !m.future ? num(m.cycles / m.tanks, 2) : '—') : kfmt(k, m[k])}</td>`).join('')}</tr>`; }).join('')}
        <tr><td>Total OPEX<small>USD</small></td><td class="r q">not set</td><td class="r q">not set</td><td class="r q">—</td><td></td>${months.map(() => '<td class="r q">—</td>').join('')}</tr></tbody></table></div></div></div>`;
  },
};
V.energy = {
  title: 'Energy and climate',
  tick(snap, full) {
    if (!full) return; const t = snap.t, p = snap.farm.power, c = snap.farm.climate, months = kpis(t), N = 96;
    const sp = [[], []], rm = [[], []], rh = []; for (let i = 0; i <= N; i++) { const x = t - DAY + i * DAY / N, pw = S.power(x), cl = S.climate(x); sp[0].push([x, pw.prod]); sp[1].push([x, pw.other]); rm[0].push([x, cl.room]); rm[1].push([x, cl.ambient]); rh.push([x, cl.rh * 100]); }
    $('#v-energy').innerHTML = `<div class="cards"><div class="card wide"><div class="stats six">${stat('Load now', num(p.total, 1) + ' kW')}${stat('Production equipment', num(p.prod, 1) + ' kW', num(S.CFG.kwTank, 2) + ' kW per tank at target')}${stat('Other', num(p.other, 1) + ' kW')}${stat('Cooling', '0 kW', 'no cooling load in the KPI basis')}
      ${stat('Hall air temperature', num(c.room, 1) + ' °C', c.room > 35 ? 'above the 35 °C limit' : 'limit 35 °C')}${stat('Hall humidity', num(c.rh * 100, 0) + ' %', 'limit 100 %')}</div></div>
      <div class="card"><div class="card-h"><h2>Electrical load, last 24 hours</h2></div>${lineChart({ title: 'Electrical load', series: [{ name: 'Production', color: '#2a78d6', pts: sp[0] }, { name: 'Other', color: '#eb6834', pts: sp[1] }], time: true, unit: 'kW', dp: 0, zero: true })}</div>
      <div class="card"><div class="card-h"><h2>Electricity by month</h2><p>Tick: one twelfth of the 1,000,000 kWh yearly budget.</p></div>${barChart({ title: 'Monthly electricity', unit: 'kWh', bars: months.map(m => ({ label: 'M' + m.m, value: m.future ? 0 : m.elecProd + m.elecOther, target: 1e6 / 12, muted: m.partial, tip: m.future ? '' : `<b>Month ${m.m}</b><br>Production ${num(m.elecProd, 0)} kWh<br>Other ${num(m.elecOther, 0)} kWh` })) })}</div>
      <div class="card"><div class="card-h"><h2>Air temperature, last 24 hours</h2></div>${lineChart({ title: 'Air temperature', series: [{ name: 'Hall', color: '#2a78d6', pts: rm[0] }, { name: 'Outside', color: '#eb6834', pts: rm[1] }], time: true, unit: '°C', dp: 1, rules: [{ y: 35, label: 'hall limit 35 °C' }] })}</div>
      <div class="card"><div class="card-h"><h2>Hall humidity, last 24 hours</h2></div>${lineChart({ title: 'Humidity', series: [{ name: 'Relative humidity', color: '#2a78d6', pts: rh }], time: true, unit: '% RH', dp: 0, yMin: 50, yMax: 100 })}</div></div>`;
  },
};
V.alarms = {
  title: 'Alarms and log',
  tick(snap, full) {
    if (!full) return; const ev = S.eventLog(snap.t - 7 * DAY, snap.t);
    $('#v-alarms').innerHTML = `<div class="cards"><div class="card wide"><div class="card-h"><h2>Active alarms</h2><p>${snap.alarms.length ? snap.alarms.length + ' active at ' + fmtDateTime(snap.t) : 'Nothing is in alarm at ' + fmtDateTime(snap.t) + '.'}</p></div>
      ${snap.alarms.length ? `<table class="grid-t"><thead><tr><th>Severity</th><th>Tank</th><th>Condition</th><th>Likely cause</th><th></th></tr></thead><tbody>${snap.alarms.map(a => { const k = a.tank + a.param; return `<tr data-tank="${a.tank}"><td>${chip(a.sev, S.SEV[a.sev])}</td><td><b>Tank ${a.tank}</b></td><td>${esc(a.text)}</td><td>${esc(a.cause || 'Not identified')}</td><td class="r">${state.acks.has(k) ? '<span class="q">Acknowledged</span>' : `<button class="btn sm" data-ack="${k}">Acknowledge</button>`}</td></tr>`; }).join('')}</tbody></table>` : ''}</div>
      <div class="card wide"><div class="card-h"><h2>Event log, last 7 days</h2><p>Process alarms and stocking or harvest operations, newest first.</p></div><table class="grid-t"><thead><tr><th>Time</th><th>Tank</th><th>Type</th><th>Event</th><th>Duration</th></tr></thead><tbody>
      ${ev.length ? ev.map(e => `<tr data-tank="${e.tank}"><td>${fmtDateTime(e.t)}</td><td>Tank ${e.tank}</td><td>${e.kind === 'alarm' ? chip(e.sev, 'Alarm') : '<span class="chip sx"><i></i>Operation</span>'}</td><td>${esc(e.text)}</td><td class="r">${e.dur ? num(e.dur, 0) + ' min' : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="q">No events in this window.</td></tr>'}</tbody></table></div></div>`;
  },
};
V.facility = {
  title: 'Facility',
  tick(snap, full) {
    if (!full) return; const f = FARM;
    $('#v-facility').innerHTML = `<div class="cards"><div class="card wide"><div class="card-h"><h2>Ground floor plan</h2><p>Redrawn from A100 and A013. Grid A–V at 4 m (U–V 5 m), rows 1–7. Tank colours follow the twin.</p></div>${planSvg(snap, { h: 430 })}</div>
      <div class="card"><div class="card-h"><h2>Site and building</h2></div><dl class="facts"><dt>Owner</dt><dd>${f.owner}</dd><dt>Consultant</dt><dd>${f.consultant}</dd><dt>Location</dt><dd>Plot ${f.location.plot}, ${f.location.sector}, ${f.location.zone}</dd><dt>Plot</dt><dd>${f.plot.w} × ${f.plot.d} m, ${num(f.plot.area, 0)} m²</dd><dt>Shrimp farm block</dt><dd>${f.block.w} × ${f.block.d} m, ${num(f.block.area, 2)} m², one storey</dd><dt>Water treatment block</dt><dd>${f.wtBlock.w} × ${f.wtBlock.d} m, ${num(f.wtBlock.area, 2)} m²</dd><dt>Built-up area</dt><dd>${num(f.builtUp, 2)} m², ${num(f.coverage * 100, 1)} % coverage</dd>
        <dt>Levels</dt><dd>Tank floor −0.30 m, tank rim +0.90 m, service rooms +0.30 m, eave +4.56 m, vault crown +6.45 m, ridge monitor +7.80 m</dd><dt>Grow-out tanks</dt><dd>28, about 10 × 10 m with rounded corners, 100 m² each (2,800 m² of culture area), Ø0.15 m centre drain</dd><dt>Roof</dt><dd>Four barrel vaults on steel trusses, sandwich-panel skin, skylights and ridge monitors</dd></dl></div>
      <div class="card"><div class="card-h"><h2>Rooms</h2></div><table class="grid-t"><thead><tr><th>Room</th><th>Size, m</th><th>Area, m²</th><th>Construction</th></tr></thead><tbody>${ROOMS.map(r => `<tr><td>${r.name}${r.note ? `<small>${r.note}</small>` : ''}</td><td class="r">${num(r.x1 - r.x0, 1)} × ${num(r.y1 - r.y0, 1)}</td><td class="r">${num((r.x1 - r.x0) * (r.y1 - r.y0), 1)}</td><td>${r.build}</td></tr>`).join('')}
        <tr><td>Water treatment room<small>Separate block</small></td><td class="r">13.9 × 12.05</td><td class="r">${num(13.9 * 12.05, 1)}</td><td>GRP / uPVC sheet on steel</td></tr></tbody></table><p class="note">Room sizes are measured off the 1:250 plan and should be checked against the dimensioned drawings.</p></div>
      <div class="card"><div class="card-h"><h2>Drawing register</h2><p>Revision 01, submitted 01-11-2025.</p></div><table class="grid-t"><thead><tr><th>No.</th><th>Title</th><th>Scale</th><th>Used for</th></tr></thead><tbody>${DRAWINGS.map(d => `<tr><td><b>${d.no}</b></td><td>${d.title}</td><td>${d.scale}</td><td>${d.note}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><div class="card-h"><h2>What this twin assumes</h2><p>Points the supplied documents do not settle.</p></div><ul class="plain">${ASSUMPTIONS.map(a => `<li>${a}</li>`).join('')}</ul></div></div>`;
  },
};
V.data = {
  title: 'Data connections',
  tick(snap, full) {
    if (!full || $('#v-data').dataset.ready) { const s = $('#src-state'); if (s) s.textContent = sourceText(); return; }
    $('#v-data').dataset.ready = '1';
    $('#v-data').innerHTML = `<div class="cards"><div class="card wide"><div class="card-h"><h2>Where the numbers come from</h2><p id="src-state">${sourceText()}</p></div>
      <p class="note">No sensor, PLC or feeding system is connected to this twin yet, so the simulator supplies every live value. It is tuned to the KPI workbook targets: 28 tanks, 3 cycles a year, 1.7 g/week, 70 % survival, 25 g harvest, FCR 1.7. Measured values you load below replace the simulated ones tank by tank and are labelled “measured”.</p></div>
      <div class="card"><div class="card-h"><h2>Load measured readings</h2><p>One reading per line: tank, parameter, value. Parameters: ${PARAMS.join(', ')}.</p></div><textarea id="csv" rows="7" spellcheck="false" placeholder="7,do,4.2&#10;7,temp,30.6&#10;12,ph,7.9"></textarea><div class="row"><button class="btn" data-act="apply-csv">Apply readings</button><button class="btn ghost" data-act="clear-csv">Remove measured values</button></div><p class="note" id="csv-msg"></p></div>
      <div class="card"><div class="card-h"><h2>Poll a live endpoint</h2><p>An HTTPS address that returns JSON like <code>{"readings":[{"tank":7,"param":"do","value":4.2}]}</code> and allows cross-origin requests.</p></div><input id="poll-url" type="url" placeholder="https://your-gateway.example/aquadev/readings" value="${esc(store.get('poll', ''))}"><div class="row"><button class="btn" data-act="poll-start">Start polling every 30 s</button><button class="btn ghost" data-act="poll-stop">Stop</button></div><p class="note" id="poll-msg"></p></div>
      <div class="card"><div class="card-h"><h2>Scenario</h2><p>The simulated farm counts its months from this date.</p></div><label class="fld">Operations start<input id="start-date" type="date" value="${new Date(S.CFG.start + 4 * HOUR).toISOString().slice(0, 10)}"></label><div class="row"><button class="btn" data-act="set-start">Apply start date</button></div></div>
      <div class="card"><div class="card-h"><h2>Test the alarm path</h2><p>Starts a simulated fault on one tank for 90 minutes.</p></div><div class="row"><label class="fld">Tank<select id="f-tank">${TANKS.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select></label><label class="fld">Fault<select id="f-type">${Object.entries(S.INCIDENT_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label></div><div class="row"><button class="btn" data-act="inject">Start test fault</button><button class="btn ghost" data-act="clear-faults">Clear test faults</button></div></div></div>`;
  },
};
function sourceText() { const n = Object.values(S.getOverrides()).reduce((s, o) => s + Object.keys(o).length, 0); return n ? `Simulator, with ${n} measured value${n > 1 ? 's' : ''} from ${state.source}.` : 'Simulator only. No measured values are loaded.'; }
function applyReadings(list, source) {
  const o = {}; let n = 0;
  for (const r of list) { const id = +r.tank, p = String(r.param || '').trim().toLowerCase(), v = +r.value; if (id >= 1 && id <= 28 && p in LIMITS && isFinite(v)) { (o[id] = o[id] || {})[p] = v; n++; } }
  S.setOverrides(o); state.source = source; return n;
}
function exportCsv(months) {
  const rows = [['KPI', 'Unit', 'First-year target', 'Full capacity', 'Realised to date', ...months.map(m => 'Month ' + m.m)]];
  for (const k of Object.keys(KPI_TARGETS)) { const d = KPI_TARGETS[k], v = agg(months, k); rows.push([d.label, d.unit, d.first, d.full, v == null ? '' : +v.toFixed(3), ...months.map(m => m.future || m[k] == null ? '' : +(+m[k]).toFixed(3))]); }
  const blob = new Blob([rows.map(r => r.map(c => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'aquadev-kpi-follow-up.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---- loop and events ----------------------------------------------------------------
let lastFull = 0, snap = null;
function tick(force) {
  const now = Date.now(); state.simT += (now - state.last) * state.speed; state.last = now;
  snap = snapshot(state.simT);
  const lag = state.simT - now, live = Math.abs(lag) < 90000 && state.speed === 1;
  $('#clock').textContent = fmtDateTime(state.simT); $('#clock-tag').textContent = live ? 'Live' : lag > 0 ? 'Forecast, +' + offs(lag) : 'Replay, −' + offs(-lag);
  $('#clock-tag').className = live ? 'tag live' : 'tag';
  const ab = $('#alarm-btn'), crit = snap.alarms.some(a => a.sev >= 3); ab.querySelector('b').textContent = snap.alarms.length; ab.className = 'alarm-btn' + (crit ? ' crit' : snap.alarms.length ? ' warn' : '');
  if (!$('#scrub').matches(':active')) $('#scrub').value = Math.max(-720, Math.min(720, lag / HOUR));
  const full = force || (!state.hoverChart && (now - lastFull > (state.speed > 1 ? 900 : 5000)));
  if (full) lastFull = now;
  V[state.view].tick(snap, full);
}
const offs = ms => ms > 2 * DAY ? num(ms / DAY, 1) + ' d' : num(ms / HOUR, 1) + ' h';
function go(view) {
  state.view = view; $$('.view').forEach(v => v.hidden = v.id !== 'v-' + view); $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('#view-title').textContent = V[view].title; if (twin) twin.running = view === 'twin'; tick(true); if (view === 'twin' && twin) twin.resize();
}
function select(id, { fly = false } = {}) { state.sel = id; if (twin) { twin.select(id); if (fly && id) twin.focus(id); } tick(true); }

async function boot() {
  initHover(h => { state.hoverChart = h; });
  $('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); });
  $('#speed').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.live) { state.simT = Date.now(); state.speed = 1; } else state.speed = +b.dataset.speed; $$('#speed button').forEach(x => x.classList.toggle('on', !x.dataset.live && +x.dataset.speed === state.speed)); tick(true); });
  $('#scrub').addEventListener('input', e => { state.simT = Date.now() + e.target.value * HOUR; state.speed = 1; $$('#speed button').forEach(x => x.classList.toggle('on', x.dataset.speed === '1')); tick(true); });
  $('#alarm-btn').addEventListener('click', () => go('alarms'));
  $('#color-by').innerHTML = Object.entries(MODES).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
  $('#color-by').addEventListener('change', e => { state.colorBy = e.target.value; tick(true); });
  $('#layers').innerHTML = Object.entries({ labels: 'Labels', equipment: 'Tank equipment', piping: 'Pipework', sensors: 'Sensor nodes', envelope: 'Walls and rooms', structure: 'Steel structure', roof: 'Roof', grid: 'Structural grid' }).map(([k, l]) => `<label><input type="checkbox" data-layer="${k}" ${state.layers[k] ? 'checked' : ''}>${l}</label>`).join('');
  $('#layers').addEventListener('change', e => { const k = e.target.dataset.layer; state.layers[k] = e.target.checked; twin && twin.setLayer(k, e.target.checked); });
  $('#views').addEventListener('click', e => { const b = e.target.closest('button'); if (b && twin) twin.setView(b.dataset.cam); });
  document.addEventListener('click', e => {
    const act = e.target.closest('[data-act]'), ack = e.target.closest('[data-ack]'), srt = e.target.closest('th[data-sort]'), par = e.target.closest('tr[data-param]'), tk = e.target.closest('[data-tank]');
    if (ack) { state.acks.add(ack.dataset.ack); return tick(true); }
    if (srt) { state.sort = srt.dataset.sort; return tick(true); }
    if (par) { state.param = par.dataset.param; return tick(true); }
    if (act) { const a = act.dataset.act;
      if (a === 'close') select(null); else if (a === 'focus') { go('twin'); twin && twin.focus(state.sel); }
      else if (a === 'fault') { S.inject(state.sel, 'aeration', state.simT); tick(true); }
      else if (a === 'export') exportCsv(kpis(state.simT));
      else if (a === 'apply-csv') { const n = applyReadings($('#csv').value.split(/\n/).map(l => l.split(/[,;\t]/)).filter(c => c.length >= 3).map(c => ({ tank: c[0], param: c[1], value: c[2] })), 'pasted readings'); $('#csv-msg').textContent = n ? `${n} reading${n > 1 ? 's' : ''} applied.` : 'No valid lines found. Use: tank, parameter, value.'; tick(true); }
      else if (a === 'clear-csv') { S.setOverrides({}); $('#csv-msg').textContent = 'Measured values removed.'; tick(true); }
      else if (a === 'poll-start') startPoll(); else if (a === 'poll-stop') { clearInterval(state.poll); state.poll = null; $('#poll-msg').textContent = 'Polling stopped.'; }
      else if (a === 'set-start') { const d = Date.parse($('#start-date').value + 'T00:00:00+04:00'); if (isFinite(d)) { S.CFG.start = d; store.set('start', d); kpiCache = null; tick(true); } }
      else if (a === 'inject') { S.inject(+$('#f-tank').value, $('#f-type').value, state.simT); select(+$('#f-tank').value); go('alarms'); }
      else if (a === 'clear-faults') { S.clearInjected(); tick(true); }
      return; }
    if (tk && !e.target.closest('#twin-host')) { const id = +tk.dataset.tank; if (state.view === 'twin' || state.view === 'tanks') select(id, { fly: state.view === 'twin' }); else { state.sel = id; twin && twin.select(id); go('tanks'); } }
  });
  try { const { Twin } = await import('./twin.js');
    twin = new Twin($('#twin-host'), { onPick: id => select(id), onHover: (id, x, y) => { if (!id || !snap) return showTip(null); const s = snap.tanks.get(id), v = tankVisual(s); showTip(`<b>${s.tk.name}</b> — ${esc(s.st.label)}<br>${s.st.stocked ? `${num(s.st.weight, 1)} g, ${num(s.st.biomass, 0)} kg, DO ${num(s.r.do, 2)} mg/L` : esc(v.text)}`, x, y); } });
    for (const k in state.layers) twin.setLayer(k, state.layers[k]); window.__twin = twin;
  } catch (err) { console.warn('3D view unavailable:', err); twin = null; }
  go('twin'); setInterval(() => tick(false), 1000);
}
function startPoll() {
  const url = $('#poll-url').value.trim(), msg = $('#poll-msg'); if (!/^https:\/\//.test(url)) { msg.textContent = 'Enter an https:// address.'; return; }
  store.set('poll', url); clearInterval(state.poll);
  const run = async () => { try { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); const j = await r.json(); const n = applyReadings(j.readings || [], 'the live endpoint'); msg.textContent = `Last poll ${fmtTime(Date.now())}: ${n} readings applied.`; } catch (e) { msg.textContent = `Last poll ${fmtTime(Date.now())} failed: ${e.message}. Check the address and that it allows cross-origin requests.`; } };
  run(); state.poll = setInterval(run, 30000);
}
boot();
