// charts.js — small SVG chart helpers (no dependencies). Every chart ships a hover layer.
const reg = new Map(); let seq = 0;
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tz = 'Asia/Dubai';
const fT = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
const fD = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short' });
const fDT = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtTime = t => fT.format(t), fmtDate = t => fD.format(t), fmtDateTime = t => fDT.format(t);
export function num(v, dp = 0) { return v == null || !isFinite(v) ? '—' : v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }); }

function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

// opts: { series:[{name,color,pts:[[x,y]],dash}], time:true|false, xLabel, unit, dp, yMin, yMax, bands:[{from,to,cls}], rules:[{y,label}], h, mark }
export function lineChart(o) {
  const id = 'c' + (++seq), W = o.w || 640, H = o.h || 200, m = { l: 44, r: o.series.length > 1 ? 86 : 14, t: 10, b: 24 };
  const all = o.series.flatMap(s => s.pts).filter(p => p[1] != null);
  if (!all.length) return `<div class="chart empty">No readings in this window — the tank is drained.</div>`;
  const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
  let lo = Math.min(...all.map(p => p[1]), ...(o.rules || []).map(r => r.y)), hi = Math.max(...all.map(p => p[1]), ...(o.rules || []).map(r => r.y));
  if (o.yMin != null) lo = Math.min(lo, o.yMin); if (o.yMax != null) hi = Math.max(hi, o.yMax);
  const pad = (hi - lo || 1) * 0.08; lo -= pad; hi += pad; if (o.zero) lo = 0;
  const X = v => m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r), Y = v => H - m.b - (v - lo) / (hi - lo) * (H - m.t - m.b);
  let g = '';
  for (const b of o.bands || []) { const a = Math.max(lo, Math.min(hi, b.from)), c = Math.max(lo, Math.min(hi, b.to)); if (c > a) g += `<rect class="band ${b.cls}" x="${m.l}" y="${Y(c).toFixed(1)}" width="${W - m.l - m.r}" height="${(Y(a) - Y(c)).toFixed(1)}"/>`; }
  for (const t of niceTicks(lo, hi)) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="tick" x="${m.l - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${num(t, o.dp ?? 1)}</text>`;
  const nx = W < 420 ? 4 : 5; for (let i = 0; i <= nx; i++) { const v = x0 + (x1 - x0) * i / nx; g += `<text class="tick" x="${X(v).toFixed(1)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === nx ? 'end' : 'middle'}">${o.time ? (x1 - x0 > 3 * 86400000 ? fmtDate(v) : fmtTime(v)) : num(v, 0)}</text>`; }
  for (const r of o.rules || []) g += `<line class="rule" x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y).toFixed(1)}" y2="${Y(r.y).toFixed(1)}"/><text class="rule-l" x="${W - m.r - 4}" y="${(Y(r.y) - 4).toFixed(1)}" text-anchor="end">${esc(r.label)}</text>`;
  const ends = [];
  for (const s of o.series) {
    let d = '', pen = false;
    for (const p of s.pts) { if (p[1] == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`; pen = true; }
    g += `<path class="line" d="${d}" stroke="${s.color}" ${s.dash ? 'stroke-dasharray="5 4"' : ''}/>`;
    const last = [...s.pts].reverse().find(p => p[1] != null); if (last) ends.push({ s, y: Y(last[1]), x: X(last[0]) });
  }
  if (o.series.length > 1) { ends.sort((a, b) => a.y - b.y); let py = -99; for (const e of ends) { const y = Math.max(e.y, py + 12); py = y; g += `<circle cx="${(W - m.r + 8).toFixed(1)}" cy="${(y - 3).toFixed(1)}" r="3.5" fill="${e.s.color}"/><text class="dl" x="${W - m.r + 15}" y="${y.toFixed(1)}">${esc(e.s.name)}</text>`; } }
  if (o.unit) g += `<text class="unit" x="${m.l}" y="9">${esc(o.unit)}</text>`;
  reg.set(id, { o, x0, x1, lo, hi, W, H, m });
  if (reg.size > 60) reg.delete(reg.keys().next().value);
  return `<div class="chart" data-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Trend chart')}">${g}<line class="cross" y1="${m.t}" y2="${H - m.b}" x1="-99" x2="-99"/><g class="dots"></g></svg><div class="tip" hidden></div></div>`;
}

// opts: { bars:[{label,value,target,tip,muted}], unit, dp, h, color }
export function barChart(o) {
  const W = o.w || 640, H = o.h || 210, m = { l: 50, r: 10, t: 14, b: 24 }, n = o.bars.length;
  const hi = Math.max(1e-9, ...o.bars.map(b => Math.max(b.value || 0, b.target || 0))) * 1.12, bw = (W - m.l - m.r) / n;
  const Y = v => H - m.b - v / hi * (H - m.t - m.b); let g = '';
  for (const t of niceTicks(0, hi)) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(t).toFixed(1)}" y2="${Y(t).toFixed(1)}"/><text class="tick" x="${m.l - 6}" y="${(Y(t) + 3.5).toFixed(1)}" text-anchor="end">${num(t, o.dp ?? 0)}</text>`;
  o.bars.forEach((b, i) => {
    const x = m.l + i * bw + bw * 0.18, w = bw * 0.64, y = Y(b.value || 0), hh = Math.max(0, H - m.b - y), r = Math.min(4, hh);
    if (b.value) g += `<path class="bar${b.muted ? ' muted' : ''}" fill="${o.color || '#2a78d6'}" d="M${x.toFixed(1)} ${H - m.b}V${(y + r).toFixed(1)}q0 ${-r} ${r} ${-r}h${(w - 2 * r).toFixed(1)}q${r} 0 ${r} ${r}V${H - m.b}z"/>`;
    if (b.target != null) g += `<line class="target" x1="${(x - 3).toFixed(1)}" x2="${(x + w + 3).toFixed(1)}" y1="${Y(b.target).toFixed(1)}" y2="${Y(b.target).toFixed(1)}"/>`;
    g += `<text class="tick" x="${(x + w / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(b.label)}</text>`;
    g += `<rect class="hit" x="${(m.l + i * bw).toFixed(1)}" y="${m.t}" width="${bw.toFixed(1)}" height="${H - m.t - m.b}" data-tip="${esc(b.tip || '')}"/>`;
  });
  if (o.unit) g += `<text class="unit" x="${m.l}" y="9">${esc(o.unit)}</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Bar chart')}">${g}</svg></div>`;
}

export function spark(pts, color = '#2a78d6', w = 84, h = 22) {
  const v = pts.filter(p => p[1] != null); if (v.length < 2) return '';
  const lo = Math.min(...v.map(p => p[1])), hi = Math.max(...v.map(p => p[1])), x0 = v[0][0], x1 = v[v.length - 1][0];
  const d = v.map((p, i) => `${i ? 'L' : 'M'}${((p[0] - x0) / (x1 - x0) * w).toFixed(1)} ${(h - 2 - (p[1] - lo) / (hi - lo || 1) * (h - 4)).toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

// one delegated hover layer for all charts and for anything carrying data-tip
let floatTip;
export function initHover(onChartHover) {
  floatTip = document.createElement('div'); floatTip.className = 'float-tip'; floatTip.hidden = true; document.body.appendChild(floatTip);
  document.addEventListener('pointermove', e => {
    const tipEl = e.target.closest && e.target.closest('[data-tip]');
    if (tipEl && tipEl.dataset.tip) { floatTip.innerHTML = tipEl.dataset.tip; floatTip.hidden = false; placeTip(e.clientX, e.clientY); } else floatTip.hidden = true;
    const ch = e.target.closest && e.target.closest('.chart[data-chart]'); onChartHover && onChartHover(!!ch);
    document.querySelectorAll('.chart .tip:not([hidden])').forEach(t => { if (!ch || !ch.contains(t)) { t.hidden = true; t.parentNode.querySelector('.cross').setAttribute('x1', -99); t.parentNode.querySelector('.cross').setAttribute('x2', -99); t.parentNode.querySelector('.dots').innerHTML = ''; } });
    if (!ch) return; const c = reg.get(ch.dataset.chart); if (!c) return;
    const b = ch.getBoundingClientRect(), fx = (e.clientX - b.left) / b.width * c.W, { m, W, H, o } = c;
    const xv = c.x0 + (Math.min(Math.max(fx, m.l), W - m.r) - m.l) / (W - m.l - m.r) * (c.x1 - c.x0);
    let rows = '', dots = '', xs = null;
    for (const s of o.series) { let best = null; for (const p of s.pts) if (p[1] != null && (!best || Math.abs(p[0] - xv) < Math.abs(best[0] - xv))) best = p; if (!best) continue;
      xs = xs ?? best[0]; const px = m.l + (best[0] - c.x0) / (c.x1 - c.x0 || 1) * (W - m.l - m.r), py = H - m.b - (best[1] - c.lo) / (c.hi - c.lo) * (H - m.t - m.b);
      dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="${s.color}" stroke="#fff" stroke-width="2"/>`;
      rows += `<div><span class="k" style="background:${s.color}"></span>${esc(s.name)}<b>${num(best[1], o.dp ?? 1)}${o.unit ? ' ' + esc(o.unit) : ''}</b></div>`; }
    if (xs == null) return; const cx = m.l + (xs - c.x0) / (c.x1 - c.x0 || 1) * (W - m.l - m.r);
    const cross = ch.querySelector('.cross'); cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); ch.querySelector('.dots').innerHTML = dots;
    const tip = ch.querySelector('.tip'); tip.hidden = false; tip.innerHTML = `<div class="th">${o.time ? fmtDateTime(xs) : (o.xLabel || '') + ' ' + num(xs, 0)}</div>${rows}`;
    const left = cx / W * b.width; tip.style.left = (left > b.width * 0.6 ? left - tip.offsetWidth - 10 : left + 10) + 'px';
  });
  document.addEventListener('pointerleave', () => { floatTip.hidden = true; });
}
function placeTip(x, y) { const w = floatTip.offsetWidth, h = floatTip.offsetHeight; floatTip.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px'; floatTip.style.top = Math.max(8, y - h - 12) + 'px'; }
export function showTip(html, x, y) { if (!floatTip) return; if (!html) { floatTip.hidden = true; return; } floatTip.innerHTML = html; floatTip.hidden = false; placeTip(x, y); }
