// sim.js — deterministic farm simulator. Every value is a pure function of (tank, time),
// so the twin can be scrubbed backwards and forwards and always shows the same history.
// Replace `reading()` inputs with real telemetry through `setOverrides()` (see Data view).
import { TANKS, LIMITS, DENSITY_LIMIT, WT_TANKS } from './model.js';

export const DAY = 86400000, HOUR = 3600000;
export const CFG = {
  start: Date.parse('2026-03-01T00:00:00+04:00'),
  tzOffsetH: 4,
  stock: 34000,          // juveniles per tank per cycle
  w0: 0.5,               // g at stocking
  growDays: 104,
  cycleDays: 365 / 3,    // 3 cycles per tank per year (KPI workbook)
  stagger: (365 / 3) / 28, // one tank stocked every ~4.3 days → continuous harvest
  growth: 1.7, survival: 0.70, fcr: 1.7, price: 10,
  kwTank: 900000 / 28 / 8760, kwOther: 100000 / 8760,
};

// ---- seeded noise -------------------------------------------------------------------
function hash(a, b = 0, c = 0, d = 0) {
  let h = 2166136261 ^ (a * 374761393) ^ (b * 668265263) ^ (c * 2246822519) ^ (d * 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
function smooth(i, ch, t, period) { // value noise in −1…1
  const k = t / period, k0 = Math.floor(k), f = k - k0, s = f * f * (3 - 2 * f);
  const a = hash(i, ch, k0 & 0x7fffffff, 7), b = hash(i, ch, (k0 + 1) & 0x7fffffff, 7);
  return (a + (b - a) * s) * 2 - 1;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const hod = t => (((t / HOUR + CFG.tzOffsetH) % 24) + 24) % 24;

// ---- production cycle ---------------------------------------------------------------
export function cycleParams(i, k) {
  const stress = hash(i, k, 4) < 0.07;
  return {
    g: CFG.growth * (0.93 + 0.14 * hash(i, k, 1)),
    S: clamp(CFG.survival * (0.9 + 0.2 * hash(i, k, 2)) * (stress ? 0.76 : 1), 0.4, 0.82),
    fcr: CFG.fcr * (0.94 + 0.12 * hash(i, k, 3)) * (stress ? 1.12 : 1),
    stress,
  };
}
const tankStart = i => CFG.start + (i - 1) * CFG.stagger * DAY;
const wAt = (p, doc) => CFG.w0 + p.g * doc / 7;
const nAt = (p, doc) => CFG.stock * Math.pow(p.S, doc / CFG.growDays);
const harvestKg = p => nAt(p, CFG.growDays) * wAt(p, CFG.growDays) / 1000;
const feedAt = (p, doc) => p.fcr * harvestKg(p) * Math.pow(clamp(doc / CFG.growDays, 0, 1), 1.3);

export function tankState(i, t) {
  const d = (t - tankStart(i)) / DAY;
  const base = { id: i, t };
  if (d < 0) return { ...base, phase: 'idle', label: 'Awaiting first stocking', short: 'Not stocked', stocked: false, cycle: 0, daysToStock: -d, biomass: 0, density: 0, count: 0, weight: 0, feedToday: 0, feedCum: 0 };
  const k = Math.floor(d / CFG.cycleDays), dc = d - k * CFG.cycleDays, p = cycleParams(i, k);
  const cycleT0 = tankStart(i) + k * CFG.cycleDays * DAY;
  const common = { ...base, cycle: k + 1, p, cycleT0, harvestAt: cycleT0 + CFG.growDays * DAY, nextStockAt: cycleT0 + CFG.cycleDays * DAY };
  if (dc >= CFG.growDays) {
    const td = dc - CFG.growDays, turn = CFG.cycleDays - CFG.growDays;
    const phase = td < 1 ? 'harvest' : td < 9 ? 'clean' : 'fill';
    const label = { harvest: 'Harvesting', clean: 'Drained — cleaning and dry-out', fill: 'Filling and conditioning' }[phase];
    const level = phase === 'harvest' ? 1 - td * 0.9 : phase === 'clean' ? 0 : clamp((td - 9) / 2.5, 0, 1);
    const short = { harvest: 'Harvesting', clean: 'Cleaning', fill: 'Filling' }[phase];
    return { ...common, phase, label, short, stocked: false, doc: null, turnDay: td, turnDays: turn, levelFrac: level,
      biomass: phase === 'harvest' ? harvestKg(p) * (1 - td) : 0, density: 0, count: 0, weight: phase === 'harvest' ? wAt(p, CFG.growDays) : 0,
      feedToday: 0, feedCum: feedAt(p, CFG.growDays), lastHarvestKg: harvestKg(p) };
  }
  const w = wAt(p, dc), n = nAt(p, dc), biomass = n * w / 1000;
  const feedCum = feedAt(p, dc), feedToday = feedAt(p, dc) - feedAt(p, Math.max(0, dc - 1));
  return { ...common, phase: 'grow', label: 'Grow-out', short: 'Grow-out', stocked: true, doc: dc, levelFrac: 1,
    weight: w, count: n, survival: n / CFG.stock, biomass, density: biomass / 100,
    feedToday, feedCum, fcrToDate: feedCum / Math.max(biomass, 1e-6), feedRate: feedToday / biomass,
    daysToHarvest: CFG.growDays - dc, projHarvestKg: harvestKg(p), projDensity: harvestKg(p) / 100, growthNow: p.g };
}

// ---- incidents ----------------------------------------------------------------------
export const INCIDENT_TYPES = {
  aeration: { label: 'Aeration loss', param: 'do', delta: -2.6 },
  pump:     { label: 'Circulation pump trip', param: 'do', delta: -1.7 },
  temp:     { label: 'Water temperature excursion', param: 'temp', delta: 2.3 },
  ph:       { label: 'pH drop', param: 'ph', delta: -0.6 },
  tan:      { label: 'Ammonia spike', param: 'tan', delta: 1.1 },
};
const TYPE_KEYS = Object.keys(INCIDENT_TYPES);
let injected = [];
export function inject(tank, type, t0, durH = 1.5) { injected.push({ tank, type, t0, t1: t0 + durH * HOUR, injected: true }); }
export function clearInjected() { injected = []; }

function dayIncident(i, dayIdx) {
  if (hash(i, dayIdx, 11) > 0.012) return null;
  const t0 = CFG.start + dayIdx * DAY + hash(i, dayIdx, 12) * DAY;
  const type = TYPE_KEYS[Math.floor(hash(i, dayIdx, 13) * TYPE_KEYS.length)];
  return { tank: i, type, t0, t1: t0 + (0.6 + 1.6 * hash(i, dayIdx, 14)) * HOUR };
}
export function incidentsBetween(tA, tB, tank = null) {
  const out = [], d0 = Math.floor((tA - CFG.start) / DAY) - 1, d1 = Math.floor((tB - CFG.start) / DAY);
  for (const tk of TANKS) {
    if (tank && tk.id !== tank) continue;
    for (let d = Math.max(0, d0); d <= d1; d++) {
      const inc = dayIncident(tk.id, d);
      if (inc && inc.t1 >= tA && inc.t0 <= tB && tankState(tk.id, inc.t0).stocked) out.push(inc);
    }
  }
  for (const inc of injected) if ((!tank || inc.tank === tank) && inc.t1 >= tA && inc.t0 <= tB) out.push(inc);
  return out.sort((a, b) => a.t0 - b.t0);
}
function incidentEffect(i, t) {
  const eff = {}; let active = null;
  for (const inc of incidentsBetween(t - 3 * HOUR, t, i)) {
    const def = INCIDENT_TYPES[inc.type], dur = inc.t1 - inc.t0;
    let f = 0;
    if (t >= inc.t0 && t <= inc.t1) { f = Math.min(1, (t - inc.t0) / (dur * 0.45)); active = inc; }
    else if (t > inc.t1) f = Math.exp(-(t - inc.t1) / (0.35 * HOUR));
    eff[def.param] = (eff[def.param] || 0) + def.delta * f;
  }
  return { eff, active };
}

// ---- live readings ------------------------------------------------------------------
let overrides = {}; // { tankId: { do: 5.1, … } } — measured values that replace the simulation
export function setOverrides(o) { overrides = o || {}; }
export function getOverrides() { return overrides; }
const MEALS = [3, 7, 11, 15, 19, 23];

export function reading(i, t, useOverrides = false) {
  const st = tankState(i, t), h = hod(t);
  if (st.phase === 'idle' || st.phase === 'clean') return { st, wet: false, active: null, pump: false, flow: 0 };
  const dens = st.stocked ? st.density : 0;
  let pulse = 0;
  if (st.stocked) for (const m of MEALS) { const dt = ((h - m) % 24 + 24) % 24; if (dt < 2.5) pulse += Math.exp(-dt / 0.7) * Math.min(1, dt / 0.15); }
  const { eff, active } = st.stocked ? incidentEffect(i, t) : { eff: {}, active: null };
  const off = (ch, a) => (hash(i, ch, 99) * 2 - 1) * a;
  const r = {
    temp: 30.0 + off(1, 0.25) + 0.35 * Math.sin(2 * Math.PI * (h - 9) / 24) + 0.10 * smooth(i, 1, t, 20 * 60000),
    do: 6.6 - 0.24 * dens - 0.28 * pulse + 0.15 * Math.sin(2 * Math.PI * (h - 15) / 24) + 0.10 * smooth(i, 2, t, 10 * 60000),
    ph: 8.05 - 0.035 * dens - 0.04 * pulse + 0.04 * smooth(i, 3, t, 30 * 60000),
    sal: 25 + off(4, 0.6) + 0.3 * smooth(i, 4, t, 5 * DAY),
    tan: Math.max(0.02, 0.10 + 0.085 * dens + 0.05 * pulse + 0.035 * smooth(i, 5, t, 40 * 60000)),
    no2: Math.max(0.01, 0.05 + 0.06 * dens + 0.03 * smooth(i, 6, t, 3 * HOUR)),
    alk: 160 - 5 * dens + 12 * smooth(i, 7, t, 2 * DAY),
    level: (st.levelFrac ?? 1) * (1.0 + 0.012 * smooth(i, 8, t, 2 * HOUR)),
  };
  for (const k in eff) r[k] += eff[k];
  r.tan = Math.max(0.02, r.tan);
  const pump = !(active && active.type === 'pump');
  const out = { st, wet: true, active, pump, flow: pump ? 46 + 2 * smooth(i, 9, t, HOUR) : 0, aeration: !(active && active.type === 'aeration'),
    hopper: st.stocked ? 100 - (((h - 6 + 24) % 24) / 24) * 82 : 100, measured: {}, ...r };
  if (useOverrides && overrides[i]) for (const k in overrides[i]) if (k in LIMITS) { out[k] = overrides[i][k]; out.measured[k] = true; }
  return out;
}

export function severity(param, v) {
  const L = LIMITS[param];
  if (v == null || !L) return 0;
  if (v <= L.lo2 || v >= L.hi2) return 3;
  if (v <= L.lo1 || v >= L.hi1) return 2;
  if (v < L.t0 || v > L.t1) return 1;
  return 0;
}
export const SEV = ['In range', 'Off target', 'Warning', 'Critical'];

export function alarmsAt(t, useOverrides = true) {
  const list = [];
  for (const tk of TANKS) {
    const r = reading(tk.id, t, useOverrides);
    if (!r.wet) continue;
    if (r.st.stocked) for (const p of ['do', 'temp', 'ph', 'tan', 'no2', 'sal', 'alk', 'level']) {
      const s = severity(p, r[p]);
      if (s >= 2) list.push({ tank: tk.id, param: p, value: r[p], sev: s, text: `${LIMITS[p].label} ${r[p].toFixed(LIMITS[p].dp)} ${LIMITS[p].unit}`, cause: r.active ? INCIDENT_TYPES[r.active.type].label : null });
    }
    if (!r.pump) list.push({ tank: tk.id, param: 'pump', sev: 3, text: 'Circulation pump tripped', cause: null });
    if (r.st.stocked && r.st.density > DENSITY_LIMIT) list.push({ tank: tk.id, param: 'density', value: r.st.density, sev: 2, text: `Density ${r.st.density.toFixed(2)} kg/m² above ${DENSITY_LIMIT}`, cause: 'Harvest or thin the tank' });
  }
  return list.sort((a, b) => b.sev - a.sev || a.tank - b.tank);
}
export function tankSeverity(i, t) {
  const r = reading(i, t, true); if (!r.wet || !r.st.stocked) return { sev: 0, r };
  let s = 0; for (const p of ['do', 'temp', 'ph', 'tan', 'no2', 'sal', 'alk', 'level']) s = Math.max(s, severity(p, r[p]));
  if (!r.pump) s = 3; if (r.st.density > DENSITY_LIMIT) s = Math.max(s, 2);
  return { sev: s, r };
}

// ---- farm-level --------------------------------------------------------------------
const AMBIENT = [18.5, 20.5, 24, 28.5, 33, 35, 36.5, 36.5, 33.5, 29.5, 24.5, 20.5]; // °C monthly means, inland Abu Dhabi
export function climate(t) {
  const d = new Date(t + CFG.tzOffsetH * HOUR), m = d.getUTCMonth(), f = d.getUTCDate() / 30, h = hod(t);
  const mean = AMBIENT[m] + (AMBIENT[(m + 1) % 12] - AMBIENT[m]) * f;
  const ambient = mean + 6.5 * Math.sin(2 * Math.PI * (h - 9) / 24) + 1.2 * smooth(0, 20, t, 6 * HOUR);
  const room = 0.36 * ambient + 0.64 * 30.2 + 0.3 * smooth(0, 21, t, 2 * HOUR);
  const rh = clamp(0.80 + 0.07 * Math.sin(2 * Math.PI * (h - 3) / 24) + 0.03 * smooth(0, 22, t, 3 * HOUR), 0.5, 1);
  return { ambient, room, rh };
}
export function power(t) {
  let prod = 0;
  for (const tk of TANKS) { const s = tankState(tk.id, t); prod += s.stocked ? CFG.kwTank * (0.93 + 0.14 * s.doc / CFG.growDays) : s.phase === 'idle' || s.phase === 'clean' ? 0.3 : 1.6; }
  const h = hod(t), other = CFG.kwOther * (0.82 + (h > 7 && h < 18 ? 0.4 : 0.05)) + 0.4 * smooth(0, 30, t, HOUR);
  return { prod, other, cool: 0, total: prod + other };
}
export function farm(t) {
  let biomass = 0, feed = 0, grow = 0, count = 0, next = null;
  for (const tk of TANKS) {
    const s = tankState(tk.id, t); biomass += s.biomass || 0; feed += s.feedToday || 0;
    if (s.stocked) { grow++; count += s.count; if (!next || s.harvestAt < next.at) next = { tank: tk.id, at: s.harvestAt, kg: s.projHarvestKg }; }
  }
  return { biomass, feed, grow, count, next, power: power(t), climate: climate(t) };
}
export function wtState(t) { // water treatment block — levels follow fill demand of the grow-out hall
  let demand = 0;
  for (const tk of TANKS) { const s = tankState(tk.id, t); if (s.phase === 'fill' && s.levelFrac < 1) demand += 100 / (2.5 * 24); else if (s.stocked) demand += 100 * 0.03 / 24; }
  const h = hod(t), saw = ((t / HOUR) % 9) / 9;
  const l1 = clamp(0.86 - 0.34 * saw - demand * 0.004, 0.15, 0.95), l2 = clamp(0.80 - 0.18 * Math.abs(Math.sin(t / (5 * HOUR))) - demand * 0.006, 0.15, 0.95);
  return { demand, tanks: [
    { ...WT_TANKS[0], frac: l1, m3: l1 * WT_TANKS[0].volume, inflow: saw < 0.2 ? 38 : 0 },
    { ...WT_TANKS[1], frac: l2, m3: l2 * WT_TANKS[1].volume, outflow: demand },
  ], transfer: 6 + demand * 0.8 + 1.5 * Math.sin(h), uv: true, filterDp: 0.32 + 0.25 * (((t / DAY) % 3) / 3) };
}

// ---- cycles, events, KPIs ----------------------------------------------------------
export function cyclesBetween(tA, tB) { // every cycle that overlaps the window
  const out = [];
  for (const tk of TANKS) for (let k = 0; ; k++) {
    const t0 = tankStart(tk.id) + k * CFG.cycleDays * DAY; if (t0 > tB) break;
    const tH = t0 + CFG.growDays * DAY, t1 = t0 + CFG.cycleDays * DAY; if (t1 < tA) continue;
    const p = cycleParams(tk.id, k);
    out.push({ tank: tk.id, k: k + 1, t0, tH, t1, p, kg: harvestKg(p), size: wAt(p, CFG.growDays), density: harvestKg(p) / 100 });
  }
  return out;
}
export function addMonths(t, n) { const d = new Date(t + CFG.tzOffsetH * HOUR); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime() - CFG.tzOffsetH * HOUR; }
function feedTotal(i, t) {
  const d = (t - tankStart(i)) / DAY; if (d < 0) return 0;
  const k = Math.floor(d / CFG.cycleDays); let sum = 0;
  for (let j = 0; j < k; j++) sum += feedAt(cycleParams(i, j), CFG.growDays);
  return sum + feedAt(cycleParams(i, k), Math.min(d - k * CFG.cycleDays, CFG.growDays));
}
export function monthlyKpis(now) {
  const months = [], cyc = cyclesBetween(CFG.start, addMonths(CFG.start, 12));
  for (let m = 0; m < 12; m++) {
    const a = addMonths(CFG.start, m), b = addMonths(CFG.start, m + 1), end = Math.min(b, now);
    if (a > now) { months.push({ m: m + 1, a, b, future: true }); continue; }
    const hv = cyc.filter(c => c.tH >= a && c.tH < end), st = cyc.filter(c => c.t0 >= a && c.t0 < end);
    const kg = hv.reduce((s, c) => s + c.kg, 0), avg = f => hv.length ? hv.reduce((s, c) => s + f(c), 0) / hv.length : null;
    let feed = 0; for (const tk of TANKS) feed += feedTotal(tk.id, end) - feedTotal(tk.id, a);
    let eP = 0, eO = 0, wT = 0, rT = 0, rH = 0;
    for (let t = a; t < end; t += 6 * HOUR) { const p = power(t), c = climate(t + 3 * HOUR); eP += p.prod * 6; eO += p.other * 6; rT = Math.max(rT, c.room + 0.9); rH = Math.max(rH, c.rh + 0.04); }
    for (const tk of TANKS) { const r = reading(tk.id, end - 14 * HOUR); if (r.wet && r.st.stocked) wT = Math.max(wT, r.temp + 0.3); }
    const price = CFG.price * (0.97 + 0.08 * hash(m, 5, 5));
    months.push({ m: m + 1, a, b, partial: b > now, tanks: TANKS.filter(tk => tankStart(tk.id) < end).length,
      juveniles: st.length * CFG.stock, harvest: kg, price: hv.length ? price : null, revenue: kg * price, cycles: hv.length,
      size: avg(c => c.size), density: hv.length ? Math.max(...hv.map(c => c.density)) : null, growth: avg(c => c.p.g), survival: avg(c => c.p.S),
      feed, elecCool: 0, elecProd: eP, elecOther: eO, waterTemp: wT || null, roomTemp: rT, roomRh: Math.min(1, rH) });
  }
  return months;
}
export function eventLog(tA, tB) {
  const ev = [];
  for (const inc of incidentsBetween(tA, tB)) ev.push({ t: inc.t0, t1: inc.t1, tank: inc.tank, kind: 'alarm', sev: inc.type === 'aeration' || inc.type === 'pump' ? 3 : 2, text: INCIDENT_TYPES[inc.type].label + (inc.injected ? ' (test)' : ''), dur: (inc.t1 - inc.t0) / 60000 });
  for (const c of cyclesBetween(tA - CFG.cycleDays * DAY, tB)) {
    if (c.t0 >= tA && c.t0 <= tB) ev.push({ t: c.t0, tank: c.tank, kind: 'op', text: `Stocked ${CFG.stock.toLocaleString('en')} juveniles (cycle ${c.k})` });
    if (c.tH >= tA && c.tH <= tB) ev.push({ t: c.tH, tank: c.tank, kind: 'op', text: `Harvest ${Math.round(c.kg)} kg at ${c.size.toFixed(1)} g, survival ${(c.p.S * 100).toFixed(0)} % (cycle ${c.k})` });
  }
  return ev.sort((a, b) => b.t - a.t);
}
export function series(i, param, tA, tB, n = 144) {
  const pts = [], step = (tB - tA) / n;
  for (let j = 0; j <= n; j++) { const t = tA + j * step, r = reading(i, t); pts.push([t, r.wet ? r[param] : null]); }
  return pts;
}
export function growthSeries(i, t) {
  const s = tankState(i, t); if (!s.cycleT0) return null;
  const actual = [], target = [], endDoc = s.stocked ? s.doc : CFG.growDays;
  for (let d = 0; d <= CFG.growDays; d += 2) { target.push([d, CFG.w0 + CFG.growth * d / 7]); if (d <= endDoc) actual.push([d, wAt(s.p, d)]); }
  if (s.stocked) actual.push([s.doc, s.weight]);
  return { actual, target };
}
