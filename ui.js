// ui.js — small shared pieces: formatting, chips, colour scales for the tanks, the plan drawing.
import { FARM, TANKS, ROOMS, WT_TANKS, GRID_X, GRID_Y, CORRIDORS, SUMPS, LIMITS, TANK_SPEC } from './model.js';
import { num, esc } from './charts.js';
import * as D from './data.js';
export { num, esc };
export const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

const hex2 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hex2(a), B = hex2(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
export const SEQ = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const seq = t => { t = Math.min(1, Math.max(0, t)) * (SEQ.length - 1); const i = Math.min(SEQ.length - 2, Math.floor(t)); return mix(SEQ[i], SEQ[i + 1], t - i); };
export const DIV = { lo: '#2a78d6', mid: '#b9c6cf', hi: '#d03b3b' };
export const TONE = { ok: '#2f8ea8', warn: '#fab219', crit: '#d03b3b', fill: '#9fd0e0' };
function divColor(p, v) { const L = LIMITS[p]; if (v >= L.t0 && v <= L.t1) return DIV.mid; return v < L.t0 ? mix(DIV.mid, DIV.lo, Math.min(1, (L.t0 - v) / (L.t0 - Math.max(L.lo2, L.min)))) : mix(DIV.mid, DIV.hi, Math.min(1, (v - L.t1) / (L.hi2 - L.t1))); }
export const MODES = {
  status:  { label: 'Alarm status', kind: 'status' },
  doc:     { label: 'Day of culture', kind: 'seq', max: D.CFG.growDays, unit: 'd', dp: 0, get: r => r.st.stocked ? r.st.doc : null },
  weight:  { label: 'Average weight', kind: 'seq', max: 28, unit: 'g', dp: 1, get: r => r.st.stocked ? r.st.weight : null },
  biomass: { label: 'Standing biomass', kind: 'seq', max: 750, unit: 'kg', dp: 0, get: r => r.st.stocked ? r.st.biomass : null },
  density: { label: 'Stocking density', kind: 'seq', max: 8, unit: 'kg/m²', dp: 2, get: r => r.st.stocked ? r.st.density : null },
  do:      { label: 'Dissolved oxygen', kind: 'div', param: 'do' }, temp: { label: 'Water temperature', kind: 'div', param: 'temp' },
  ph:      { label: 'pH', kind: 'div', param: 'ph' }, tan: { label: 'Total ammonia N', kind: 'div', param: 'tan' },
};
export function tankVisual(x, colorBy) {
  const m = MODES[colorBy], r = x.r, st = x.st; let color = TONE.ok, text = '';
  const level = r.wet ? Math.max(0, Math.min(1, r.level ?? 1)) : 0;
  if (m.kind === 'status') { color = !st.stocked ? TONE.fill : x.sev >= 3 ? TONE.crit : x.sev === 2 ? TONE.warn : TONE.ok; text = st.stocked ? `day ${Math.floor(st.doc)}` : st.short.toLowerCase(); }
  else if (m.kind === 'seq') { const v = m.get(r); color = v == null ? '#c9d1d9' : seq(v / m.max); text = v == null ? '—' : num(v, m.dp) + ' ' + m.unit; }
  else { const v = r.wet && st.stocked ? r[m.param] : null; color = v == null ? '#c9d1d9' : divColor(m.param, v); text = v == null ? '—' : num(v, LIMITS[m.param].dp) + (LIMITS[m.param].unit ? ' ' + LIMITS[m.param].unit : ''); }
  return { color, level, sev: x.sev, text, dim: !st.stocked };
}
export function legendHtml(colorBy) {
  const m = MODES[colorBy];
  if (m.kind === 'status') return `<ul class="lg-list"><li><i style="background:${TONE.ok}"></i>No open alarm</li><li><i style="background:${TONE.warn}"></i>Warning alarm</li><li><i style="background:${TONE.crit}"></i>Critical alarm</li><li><i style="background:${TONE.fill}"></i>Filling or harvesting</li><li><i class="hollow"></i>Drained</li></ul>`;
  if (m.kind === 'seq') return `<div class="lg-bar" style="background:linear-gradient(90deg,${SEQ.join(',')})"></div><div class="lg-ax"><span>0</span><span>${num(m.max / 2, 0)}</span><span>${num(m.max, 0)} ${m.unit}</span></div>`;
  const L = LIMITS[m.param];
  return `<div class="lg-bar" style="background:linear-gradient(90deg,${DIV.lo},${DIV.mid} 40%,${DIV.mid} 60%,${DIV.hi})"></div><div class="lg-ax"><span>low</span><span>target ${L.t0}–${L.t1} ${L.unit}</span><span>high</span></div>`;
}

export const chip = (sev, text) => `<span class="chip s${sev}"><i></i>${esc(text)}</span>`;
export const phaseChip = x => x.st.stocked ? chip(x.sev === 0 ? 0 : x.sev, x.sev >= 2 ? D.SEV[x.sev] + ' alarm' : 'Grow-out') : `<span class="chip sx" title="${esc(x.st.label)}"><i></i>${esc(x.st.short)}</span>`;
export function rangeBar(p, v) {
  if (v == null) return '<div class="rb none"></div>';
  const L = LIMITS[p], pos = x => Math.min(100, Math.max(0, (x - L.min) / (L.max - L.min) * 100));
  const seg = (a, b, c) => b > a ? `<span class="${c}" style="left:${pos(a)}%;width:${pos(b) - pos(a)}%"></span>` : '';
  return `<div class="rb">${seg(L.min, Math.max(L.min, L.lo2), 'c')}${seg(Math.max(L.min, L.lo2), Math.max(L.min, L.lo1), 'w')}${seg(L.t0, L.t1, 'g')}${seg(L.hi1, L.hi2, 'w')}${seg(L.hi2, L.max, 'c')}<b style="left:${pos(v)}%"></b></div>`;
}
export function stat(label, value, sub = '') { return `<div class="stat"><span>${label}</span><b>${value}</b>${sub ? `<em>${sub}</em>` : ''}</div>`; }
export const assumed = `<abbr class="as" title="Assumed — not stated in the supplied documents">assumed</abbr>`;
export const srcTag = src => src === 'sample' ? '<span class="src sample" title="Generated sample history, not farm data">sample</span>' : src === 'entered' ? '<span class="src entered" title="Entered by Aqua Development">entered</span>' : '';
let toastT; export function toast(msg, kind = '') { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); } el.textContent = msg; el.className = 'show ' + kind; clearTimeout(toastT); toastT = setTimeout(() => { el.className = ''; }, 4200); }

export function planSvg(snap, { h = 360, labels = true, sel = null, colorBy = 'status' } = {}) {
  let g = `<rect class="slab" x="0" y="0" width="85" height="50"/><rect class="slab" x="${FARM.wtBlock.x0}" y="${FARM.wtBlock.y0}" width="14" height="12.15"/>`;
  for (const c of CORRIDORS) g += `<rect class="corr" x="0.2" y="${c.y0}" width="81.3" height="${c.y1 - c.y0}"/>`;
  for (const s of SUMPS) g += `<rect class="sump" x="${s.x - 1}" y="${s.y - 0.75}" width="2" height="1.5"/>`;
  for (const r of ROOMS) g += `<rect class="room" x="${r.x0}" y="${r.y0}" width="${r.x1 - r.x0}" height="${r.y1 - r.y0}" data-tip="${esc(r.name)}${r.note ? ' — ' + esc(r.note) : ''}"/>`;
  for (const w of WT_TANKS) g += `<rect class="wtt" x="${w.x0}" y="${w.y0}" width="${w.x1 - w.x0}" height="${w.y1 - w.y0}" data-tip="${esc(w.name)} — ${num(w.volume, 0)} m³ gross"/>`;
  for (const tk of TANKS) { const x = snap.tanks.get(tk.id), v = tankVisual(x, colorBy);
    g += `<g class="pt${sel === tk.id ? ' sel' : ''}" data-tank="${tk.id}" data-tip="<b>${tk.name}</b> — ${esc(x.st.label)}<br>${esc(v.text)}"><rect x="${tk.x0}" y="${tk.y0}" width="${tk.x1 - tk.x0}" height="${tk.y1 - tk.y0}" rx="${TANK_SPEC.cornerRadius}" fill="${v.level > 0.02 ? v.color : '#eef1f4'}"/>${labels ? `<text x="${tk.cx}" y="${tk.cy + 1.3}">${tk.id}</text>` : ''}</g>`; }
  if (labels) { for (const gx of GRID_X) g += `<text class="gl" x="${gx.x}" y="-1.4">${gx.name}</text>`; for (const gy of GRID_Y) g += `<text class="gl" x="-2" y="${gy.y + 0.8}">${gy.name}</text>`; }
  return `<svg class="plan" viewBox="-4 -4 106 57" style="height:${h}px" role="img" aria-label="Plan of the farm block">${g}</svg>`;
}
