// data.js — the farm record. Aqua Development enters one data round per 6-hour slot (00, 06, 12, 18 GST);
// everything the platform shows is the latest round at or before the time being viewed.
// Until the first real round exists, a sample history from sim.js stands in so the platform is not empty.
// Storage is this browser's localStorage; swap load()/save() for a shared database to make it multi-device.
import { TANKS, LIMITS, DENSITY_LIMIT, WT_TANKS } from './model.js';
import * as S from './sim.js';

export const DAY = S.DAY, HOUR = S.HOUR, SLOT = 6 * HOUR, CFG = S.CFG, SEV = S.SEV, severity = S.severity, addMonths = S.addMonths, cyclesBetween = S.cyclesBetween;
export const PARAMS = ['do', 'temp', 'ph', 'sal', 'tan', 'no2', 'alk', 'level'];
export const STATUS = { grow: ['Grow-out', 'Grow-out'], harvest: ['Harvesting', 'Harvesting'], clean: ['Drained — cleaning and dry-out', 'Cleaning'], fill: ['Filling and conditioning', 'Filling'], idle: ['Not stocked', 'Not stocked'] };
const TZ = 4 * HOUR, KEY = 'aquadev.db.v1', GRACE = 45 * 60000;
export const slotOf = t => Math.floor((t + TZ) / SLOT) * SLOT - TZ;

let db = { sample: true, liveFrom: null, rounds: [], events: [], alarms: [] }, memo = new Map();
const touch = () => { memo = new Map(); if (!Array.isArray(db.alarms)) db.alarms = []; db.rounds.sort((a, b) => a.t - b.t); db.events.sort((a, b) => a.t - b.t); db.alarms.sort((a, b) => b.t - a.t); };
export function load() { try { const raw = localStorage.getItem(KEY); if (raw) db = { ...db, ...JSON.parse(raw) }; } catch { /* storage unavailable */ } touch(); return db; }
function save() { touch(); try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch { return false; } }
export const getDb = () => db;
export function replaceDb(o) { if (!o || !Array.isArray(o.rounds) || !Array.isArray(o.events)) throw new Error('This file is not an AquaDev data file.'); db = { sample: o.sample !== false, liveFrom: o.liveFrom ?? null, rounds: o.rounds, events: o.events, alarms: Array.isArray(o.alarms) ? o.alarms : [] }; return save(); }
export function setSample(on) { db.sample = !!on; return save(); }
export function clearRecords() { db = { sample: true, liveFrom: null, rounds: [], events: [], alarms: [] }; return save(); }
const sampleOn = t => db.sample !== false && (db.liveFrom == null || t < db.liveFrom);

// ---- rounds and events -----------------------------------------------------------------
export function roundAt(t) { for (let i = db.rounds.length - 1; i >= 0; i--) if (db.rounds[i].t <= t) return db.rounds[i]; return null; }
export const roundFor = slot => db.rounds.find(r => r.t === slot) || null;
export function submitRound(r) {
  const i = db.rounds.findIndex(x => x.t === r.t); if (i >= 0) db.rounds[i] = r; else db.rounds.push(r);
  db.liveFrom = db.liveFrom == null ? r.t : Math.min(db.liveFrom, r.t); return save();
}
export function addEvent(e) { db.events.push(e); return save(); }
const lastEvent = (i, type, t) => { for (let k = db.events.length - 1; k >= 0; k--) { const e = db.events[k]; if (e.tank === i && e.type === type && e.t <= t) return e; } return null; };

// ---- alarms: recorded by people, never raised automatically ------------------------------
export const ALARM_TYPES = ['Low dissolved oxygen', 'Aeration failure', 'Pump or circulation failure', 'Water temperature', 'Water quality', 'Abnormal mortality', 'Disease suspected', 'Power outage', 'Water treatment', 'Equipment fault', 'Hall climate', 'Other'];
export const AREAS = { farm: 'Whole farm', wt: 'Water treatment', power: 'Electrical supply', hall: 'Hall climate' };
export const areaName = a => a.tank ? 'Tank ' + String(a.tank).padStart(2, '0') : AREAS[a.area] || 'Whole farm';
export function addAlarm(a) { db.alarms.push({ id: 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), status: 'open', acks: [], ...a }); return save(); }
export function resolveAlarm(id, { by, note, t }) { const a = db.alarms.find(x => x.id === id); if (!a) return false; Object.assign(a, { status: 'resolved', rt: t, rby: by, rnote: note || '' }); return save(); }
export function ackAlarm(id, by, t) { const a = db.alarms.find(x => x.id === id); if (!a) return false; a.acks = a.acks || []; if (!a.acks.some(k => k.by === by)) a.acks.push({ by, t }); return save(); }
export const alarmsAt = t => db.alarms.filter(a => a.t <= t && (a.status !== 'resolved' || a.rt > t)).sort((a, b) => b.sev - a.sev || b.t - a.t);
export const alarmsBetween = (tA, tB) => db.alarms.filter(a => a.t <= tB && (a.status !== 'resolved' || a.rt >= tA) || (a.t >= tA && a.t <= tB));

export function freshness(now) {
  const slot = slotOf(now), live = db.liveFrom != null, cur = roundFor(slot), last = roundAt(now); let missed = 0;
  if (live) for (let s = slot - SLOT; s >= Math.max(db.liveFrom, slot - 4 * SLOT); s -= SLOT) if (!roundFor(s)) missed++;
  return { slot, due: slot + SLOT, live, submitted: !!cur, last: live ? last : null, lastT: live ? (last ? last.at || last.t : null) : (db.sample !== false ? slot : null),
    by: live ? last && last.by : 'Sample data', overdue: live && !cur && now - slot > GRACE, missed, sample: !live && db.sample !== false, empty: !live && db.sample === false };
}

// ---- tank state and readings -----------------------------------------------------------
function feedSums(i, r, t, cycleT0) {
  const key = i + '|' + r.t + '|' + cycleT0; let m = memo.get(key);
  if (!m) { let day = 0, cum = 0; for (const x of db.rounds) { if (x.t > r.t) break; const f = x.tanks[i] && x.tanks[i].feed || 0; if (x.t > r.t - DAY) day += f; if (x.t >= cycleT0) cum += f; }
    let base = 0, frac = 0; if (db.sample !== false && db.liveFrom != null && cycleT0 < db.liveFrom) { const s = S.tankState(i, db.liveFrom); if (s.cycleT0 === cycleT0) base = s.feedCum || 0; frac = Math.max(0, Math.min(1, (db.liveFrom - (r.t - DAY)) / DAY)) * (S.tankState(i, db.liveFrom).feedToday || 0); }
    m = { day: day + frac, cum: cum + base }; memo.set(key, m); }
  return m;
}
export function tankState(i, t) {
  const r = roundAt(t), x = r && r.tanks[i];
  if (!x) { if (sampleOn(t)) return { ...S.tankState(i, slotOf(t)), src: 'sample' }; return { id: i, t, phase: 'idle', label: 'No data entered', short: 'No data', stocked: false, biomass: 0, density: 0, count: 0, weight: 0, feedToday: 0, feedCum: 0, src: 'none' }; }
  const base = S.tankState(i, t), ev = lastEvent(i, 'stock', t), hv = lastEvent(i, 'harvest', t), p = base.p || S.cycleParams(i, 0);
  let cycleT0 = base.cycleT0 ?? CFG.start; if (ev && ev.t > cycleT0 - DAY) cycleT0 = ev.t;
  const s = STATUS[x.s] ? x.s : 'idle', stocked = s === 'grow', doc = Math.max(0, (t - cycleT0) / DAY), w = x.w ?? 0, n = x.n ?? 0, biomass = stocked || s === 'harvest' ? n * w / 1000 : 0;
  const f = feedSums(i, r, t, cycleT0), left = Math.max(0, CFG.growDays - doc), stockN = (ev && ev.n) || CFG.stock, pw = w + p.g * left / 7, pn = n * Math.pow(p.S, left / CFG.growDays);
  let g = null; for (let k = db.rounds.length - 1; k >= 0; k--) { const o = db.rounds[k]; if (o.t > r.t - 6 * DAY || o.t < cycleT0) continue; const ow = o.tanks[i] && o.tanks[i].w; if (ow != null && r.t > o.t) g = (w - ow) / ((r.t - o.t) / DAY) * 7; break; }
  return { id: i, t, src: 'entered', cycle: base.cycle || 1, p, cycleT0, harvestAt: cycleT0 + CFG.growDays * DAY, nextStockAt: cycleT0 + CFG.cycleDays * DAY, phase: s, label: STATUS[s][0], short: STATUS[s][1], stocked,
    doc: stocked ? doc : null, levelFrac: x.level != null ? Math.min(1.2, x.level) : (s === 'clean' || s === 'idle' ? 0 : 1), weight: w, count: n, mort: x.mort ?? null, survival: n / stockN, biomass, density: biomass / 100,
    feedToday: f.day, feedCum: f.cum, fcrToDate: biomass ? f.cum / biomass : null, feedRate: biomass ? f.day / biomass : 0, daysToHarvest: left, projHarvestKg: pn * pw / 1000, projDensity: pn * pw / 100000,
    growthNow: g != null && isFinite(g) && g > 0 ? g : p.g, lastHarvestKg: hv ? hv.kg : base.lastHarvestKg };
}
export function reading(i, t) {
  const r = roundAt(t), x = r && r.tanks[i];
  if (x) { const st = tankState(i, t), wet = st.phase !== 'idle' && st.phase !== 'clean'; return { st, wet, src: 'entered', at: r.t, by: r.by, measured: {}, do: x.do ?? null, temp: x.temp ?? null, ph: x.ph ?? null, sal: x.sal ?? null, tan: x.tan ?? null, no2: x.no2 ?? null, alk: x.alk ?? null, level: x.level ?? (wet ? 1 : 0) }; }
  if (sampleOn(t)) { const ts = slotOf(t), b = S.reading(i, ts); return { ...b, st: { ...b.st, src: 'sample' }, src: 'sample', at: ts, by: 'Sample data' }; }
  return { st: tankState(i, t), wet: false, src: 'none', measured: {} };
}
export function tankSeverity(i, t, open = alarmsAt(t)) { // sev: worst open recorded alarm on the tank; flag: worst reading outside its limits
  const r = reading(i, t); let sev = 0, flag = 0; for (const a of open) if (a.tank === i) sev = Math.max(sev, a.sev);
  if (r.wet && r.st.stocked) { for (const p of PARAMS) flag = Math.max(flag, severity(p, r[p])); if (r.st.density > DENSITY_LIMIT) flag = Math.max(flag, 2); }
  return { sev, flag, r };
}
export function flagsAt(t) {
  const list = [];
  for (const tk of TANKS) { const r = reading(tk.id, t); if (!r.wet || !r.st.stocked) continue;
    for (const p of PARAMS) { const s = severity(p, r[p]); if (s >= 2) list.push({ tank: tk.id, param: p, value: r[p], sev: s, text: `${LIMITS[p].label} ${(+r[p]).toFixed(LIMITS[p].dp)} ${LIMITS[p].unit}`, at: r.at }); }
    if (r.st.density > DENSITY_LIMIT) list.push({ tank: tk.id, param: 'density', value: r.st.density, sev: 2, text: `Density ${r.st.density.toFixed(2)} kg/m² above ${DENSITY_LIMIT}`, at: r.at }); }
  return list.sort((a, b) => b.sev - a.sev || a.tank - b.tank);
}

// ---- farm level ------------------------------------------------------------------------
export function farmVals(t) {
  const r = roundAt(t);
  if (r) { const f = r.farm || {}, prod = f.kwhProd != null ? f.kwhProd / 6 : null, other = f.kwhOther != null ? f.kwhOther / 6 : null;
    return { src: 'entered', power: { prod, other, cool: 0, total: prod == null && other == null ? null : (prod || 0) + (other || 0) }, climate: { room: f.roomT ?? null, rh: f.roomRh != null ? f.roomRh / 100 : null, ambient: f.outT ?? null }, wt: [f.wt1 != null ? f.wt1 / 100 : null, f.wt2 != null ? f.wt2 / 100 : null], note: r.note }; }
  if (sampleOn(t)) { const ts = slotOf(t), w = S.wtState(ts); return { src: 'sample', power: S.power(ts), climate: S.climate(ts), wt: w.tanks.map(k => k.frac), demand: w.demand, transfer: w.transfer, filterDp: w.filterDp }; }
  return { src: 'none', power: { prod: null, other: null, cool: 0, total: null }, climate: { room: null, rh: null, ambient: null }, wt: [null, null] };
}
export function farm(t) {
  let biomass = 0, feed = 0, grow = 0, count = 0, next = null; const fv = farmVals(t);
  for (const tk of TANKS) { const s = tankState(tk.id, t); biomass += s.biomass || 0; feed += s.feedToday || 0;
    if (s.stocked) { grow++; count += s.count || 0; if (!next || s.harvestAt < next.at) next = { tank: tk.id, at: s.harvestAt, kg: s.projHarvestKg }; } }
  return { biomass, feed, grow, count, next, power: fv.power, climate: fv.climate };
}
export function wtState(t) { const fv = farmVals(t); return { src: fv.src, demand: fv.demand ?? null, transfer: fv.transfer ?? null, filterDp: fv.filterDp ?? null, tanks: WT_TANKS.map((w, k) => ({ ...w, frac: fv.wt[k], m3: fv.wt[k] == null ? null : fv.wt[k] * w.volume })) }; }
export function farmSeries(pick, tA, tB) { const pts = []; for (let ts = slotOf(tA) + SLOT; ts <= tB; ts += SLOT) pts.push([ts, pick(farmVals(ts))]); return pts; }
export function series(i, param, tA, tB) { const pts = []; for (let ts = slotOf(tA) + SLOT; ts <= tB; ts += SLOT) { const r = reading(i, ts); pts.push([ts, r.wet ? r[param] ?? null : null]); } return pts; }
export function growthSeries(i, t) {
  const s = tankState(i, t); if (s.src !== 'entered') return S.growthSeries(i, slotOf(t));
  const target = [], actual = []; for (let d = 0; d <= CFG.growDays; d += 2) target.push([d, CFG.w0 + CFG.growth * d / 7]);
  if (db.sample !== false && s.cycleT0 < db.liveFrom) { const b = S.growthSeries(i, db.liveFrom); if (b) actual.push(...b.actual); }
  for (const r of db.rounds) { if (r.t < s.cycleT0 || r.t > t) continue; const x = r.tanks[i]; if (x && x.w != null && x.s === 'grow') actual.push([(r.t - s.cycleT0) / DAY, x.w]); }
  return { actual, target };
}

// ---- log and KPIs ----------------------------------------------------------------------
export function eventLog(tA, tB) {
  const ev = [], cut = db.liveFrom != null ? Math.min(db.liveFrom, tB) : tB;
  if (db.sample !== false && cut > tA) for (const e of S.eventLog(tA, cut)) if (e.kind !== 'alarm') ev.push({ ...e, src: 'sample' });
  for (const a of db.alarms) { if (a.t >= tA && a.t <= tB) ev.push({ t: a.t, tank: a.tank || null, where: areaName(a), kind: 'alarm', sev: a.sev, src: 'entered', by: a.by, text: `${a.type}${a.text ? ' — ' + a.text : ''}` }); if (a.status === 'resolved' && a.rt >= tA && a.rt <= tB) ev.push({ t: a.rt, tank: a.tank || null, where: areaName(a), kind: 'resolved', src: 'entered', by: a.rby, text: `Alarm resolved: ${a.type}${a.rnote ? ' — ' + a.rnote : ''}` }); }
  for (const e of db.events) if (e.t >= tA && e.t <= tB) ev.push({ t: e.t, tank: e.tank, kind: 'op', src: 'entered', by: e.by, text: e.type === 'stock' ? `Stocked ${(+e.n || 0).toLocaleString('en')} juveniles` : `Harvest ${Math.round(e.kg || 0)} kg${e.size ? ' at ' + (+e.size).toFixed(1) + ' g' : ''}` });
  for (const r of db.rounds) if (r.t >= tA && r.t <= tB) { let bad = 0, blank = 0; for (const tk of TANKS) { const x = r.tanks[tk.id]; if (!x || x.s !== 'grow') continue; for (const p of PARAMS) { if (x[p] == null) blank++; else if (severity(p, x[p]) >= 2) bad++; } }
    ev.push({ t: r.at || r.t, tank: null, kind: 'round', src: 'entered', by: r.by, slot: r.t, bad, blank, text: `Data round entered by ${r.by || 'AD'}${bad ? ` — ${bad} reading${bad > 1 ? 's' : ''} outside limits` : ''}${r.note ? ` — “${r.note}”` : ''}` }); }
  return ev.sort((a, b) => b.t - a.t);
}
export function harvests(tA, tB) {
  const out = [], cut = db.liveFrom != null ? Math.min(db.liveFrom, tB) : tB;
  if (db.sample !== false) for (const c of S.cyclesBetween(tA - CFG.cycleDays * DAY, cut)) if (c.tH >= tA && c.tH < cut) out.push({ t: c.tH, tank: c.tank, kg: c.kg, size: c.size, src: 'sample' });
  for (const e of db.events) if (e.type === 'harvest' && e.t >= tA && e.t <= tB) out.push({ t: e.t, tank: e.tank, kg: +e.kg || 0, size: e.size, src: 'entered' });
  return out.sort((a, b) => a.t - b.t);
}
export function feedBetween(tA, tB) {
  let kg = 0; for (let ts = slotOf(tA) + SLOT; ts <= tB; ts += SLOT) { const r = roundFor(ts);
    if (r && ts >= (db.liveFrom ?? Infinity)) { for (const tk of TANKS) kg += (r.tanks[tk.id] && +r.tanks[tk.id].feed) || 0; } else if (sampleOn(ts)) for (const tk of TANKS) kg += (S.tankState(tk.id, ts).feedToday || 0) / 4; }
  return kg;
}
export function roundsBetween(tA, tB) { const out = []; for (let ts = slotOf(tA) + SLOT; ts <= tB; ts += SLOT) out.push({ slot: ts, round: roundFor(ts), expected: db.liveFrom != null && ts >= db.liveFrom }); return out; }
export function monthlyKpis(now) {
  const cut = db.liveFrom != null ? Math.min(db.liveFrom, now) : now, months = S.monthlyKpis(db.sample === false ? CFG.start - 1 : cut);
  for (const m of months) {
    if (db.sample === false && m.a <= now) Object.assign(m, { future: false, tanks: 28, juveniles: 0, harvest: 0, price: null, revenue: 0, cycles: 0, size: null, density: null, growth: null, survival: null, feed: 0, elecCool: 0, elecProd: 0, elecOther: 0, waterTemp: null, roomTemp: null, roomRh: null });
    if (db.liveFrom == null) continue; const a = Math.max(m.a, db.liveFrom), b = Math.min(m.b, now); if (b <= a) { if (m.a <= now) m.partial = m.b > now; continue; }
    if (m.future) Object.assign(m, { future: false, tanks: 28, juveniles: 0, harvest: 0, price: null, revenue: 0, cycles: 0, size: null, density: null, growth: null, survival: null, feed: 0, elecCool: 0, elecProd: 0, elecOther: 0, waterTemp: null, roomTemp: null, roomRh: null });
    m.partial = m.b > now; const mx = (u, v) => v == null ? u : u == null ? v : Math.max(u, v);
    for (const e of db.events) { if (e.t < a || e.t >= b) continue; if (e.type === 'stock') m.juveniles += +e.n || 0; else { const k = +e.kg || 0; if (e.size) m.size = m.size == null ? +e.size : (m.size * m.cycles + +e.size) / (m.cycles + 1); m.harvest += k; m.cycles += 1; m.density = mx(m.density, k / 100); } }
    for (const r of db.rounds) { if (r.t < a || r.t >= b) continue; const f = r.farm || {}; m.elecProd += +f.kwhProd || 0; m.elecOther += +f.kwhOther || 0; m.roomTemp = mx(m.roomTemp, f.roomT); m.roomRh = mx(m.roomRh, f.roomRh != null ? f.roomRh / 100 : null);
      for (const tk of TANKS) { const x = r.tanks[tk.id]; if (!x) continue; m.feed += +x.feed || 0; if (x.s === 'grow') { m.waterTemp = mx(m.waterTemp, x.temp); if (x.n != null && x.w != null) m.density = mx(m.density, x.n * x.w / 100000); } } }
    if (m.harvest) { m.price = m.price ?? CFG.price; m.revenue = m.harvest * m.price; }
  }
  return months;
}

// values offered to the data-entry form as "previous" for a slot
export function previousFor(slot) {
  const out = {}; for (const tk of TANKS) { const r = reading(tk.id, slot - 1), st = r.st; out[tk.id] = { s: STATUS[st.phase] ? st.phase : 'idle', w: st.weight ? +st.weight.toFixed(1) : null, n: st.count ? Math.round(st.count) : null };
    for (const p of PARAMS) out[tk.id][p] = r.wet && r[p] != null ? +(+r[p]).toFixed(LIMITS[p].dp) : null; }
  const fv = farmVals(slot - 1); out.farm = { kwhProd: fv.power.prod != null ? Math.round(fv.power.prod * 6) : null, kwhOther: fv.power.other != null ? Math.round(fv.power.other * 6) : null, roomT: fv.climate.room != null ? +fv.climate.room.toFixed(1) : null, roomRh: fv.climate.rh != null ? Math.round(fv.climate.rh * 100) : null, wt1: fv.wt[0] != null ? Math.round(fv.wt[0] * 100) : null, wt2: fv.wt[1] != null ? Math.round(fv.wt[1] * 100) : null };
  return out;
}
