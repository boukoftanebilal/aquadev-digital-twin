// report.js — builds the PDF reports Innovation Oasis issues. Uses jsPDF, loaded on first use.
import { TANKS, LIMITS, KPI_TARGETS, DENSITY_LIMIT } from './model.js';
import * as D from './data.js';
import { num } from './charts.js';

export const TYPES = {
  status:  { name: 'Farm status report', hours: 6, blurb: 'The farm as of one data round: every tank, readings outside limits, the round log.' },
  daily:   { name: 'Daily report', hours: 24, blurb: 'The last 24 hours: four rounds, feed, harvests and events.' },
  weekly:  { name: 'Weekly report', hours: 168, blurb: 'Seven days of rounds, feed, harvests and events.' },
  monthly: { name: 'Monthly KPI report', hours: 720, blurb: 'Thirty days plus the KPI follow-up against first-year and full-capacity targets.' },
};
const IO = [63, 168, 205], NAVY = [16, 46, 66], GREY = [110, 118, 126], LINE = [214, 221, 227], PALE = [243, 247, 249], RED = [190, 40, 40], AMBER = [176, 112, 0];
const tz = 'Asia/Dubai', fDT = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }), fD = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const clean = s => String(s ?? '').replace(/[—–−]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/₃/g, '3').replace(/…/g, '...');

async function lib() {
  if (!window.jspdf) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js'; s.onload = res; s.onerror = () => rej(new Error('The PDF library could not be loaded. Check the internet connection and try again.')); document.head.appendChild(s); });
  return window.jspdf.jsPDF;
}
function raster(src, w, h, bg) {
  return new Promise(res => { const im = new Image(); im.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } g.drawImage(im, 0, 0, w, h); res(c.toDataURL('image/png')); }; im.onerror = () => res(null); im.src = src; });
}

export async function buildReport({ type, t, session, shot }) {
  const JsPDF = await lib(), T = TYPES[type], doc = new JsPDF({ unit: 'mm', format: 'a4', compress: true }), W = 210, H = 297, M = 14, tA = t - T.hours * D.HOUR;
  const [ioLogo, adLogo] = await Promise.all([raster('io-logo.webp', 416, 560, '#ffffff'), raster('ad-logo.svg', 260, 192)]);
  const fr = D.freshness(t), rounds = D.roundsBetween(tA, t), got = rounds.filter(r => r.round).length, exp = rounds.filter(r => r.expected).length, sample = rounds.some(r => !r.expected) && D.getDb().sample !== false;
  const open = D.alarmsAt(t), recorded = D.alarmsBetween(tA, t).sort((a, b) => b.t - a.t), snap = TANKS.map(tk => { const { sev, r } = D.tankSeverity(tk.id, t, open); return { tk, r, st: r.st, sev }; }), alarms = D.flagsAt(t), farm = D.farm(t), hv = D.harvests(tA, t), feed = D.feedBetween(tA, t), last = D.roundAt(t);
  let y = 0;
  const text = (s, x, yy, o = {}) => { doc.setFont('helvetica', o.b ? 'bold' : 'normal'); doc.setFontSize(o.s || 9); doc.setTextColor(...(o.c || NAVY)); doc.text(clean(s), x, yy, { align: o.a || 'left', maxWidth: o.w }); };
  const need = h => { if (y + h > H - 20) { doc.addPage(); y = 18; } };
  const h2 = s => { need(16); doc.setFillColor(...IO); doc.rect(M, y, 1.6, 5.2, 'F'); text(s, M + 4, y + 4.2, { b: 1, s: 11.5 }); y += 9; };
  const para = (s, c = GREY) => { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); const lines = doc.splitTextToSize(clean(s), W - 2 * M); need(lines.length * 4.4 + 2); doc.setTextColor(...c); doc.text(lines, M, y + 3); y += lines.length * 4.4 + 3; };
  function table(cols, rows, { size = 7.6, rh = 5.6 } = {}) {
    const tw = cols.reduce((s, c) => s + c.w, 0), k = (W - 2 * M) / tw, xs = []; let x = M; for (const c of cols) { xs.push(x); x += c.w * k; }
    const head = () => { doc.setFillColor(...NAVY); doc.rect(M, y, W - 2 * M, rh + 0.6, 'F'); cols.forEach((c, i) => text(c.h, c.a === 'r' ? xs[i] + c.w * k - 1.5 : xs[i] + 1.5, y + rh - 1.5, { b: 1, s: size, c: [255, 255, 255], a: c.a === 'r' ? 'right' : 'left' })); y += rh + 0.6; };
    need(rh * 3); head();
    rows.forEach((r, n) => { if (y + rh > H - 20) { doc.addPage(); y = 18; head(); } if (n % 2) { doc.setFillColor(...PALE); doc.rect(M, y, W - 2 * M, rh, 'F'); }
      r.forEach((cell, i) => { const c = cols[i], o = cell && typeof cell === 'object' ? cell : { v: cell }, flag = o.f; if (flag) { doc.setFillColor(...(flag === 3 ? [250, 220, 220] : [255, 240, 200])); doc.rect(xs[i] + 0.3, y + 0.4, c.w * k - 0.6, rh - 0.8, 'F'); }
        let s = clean(o.v ?? ''); doc.setFont('helvetica', o.b || flag ? 'bold' : 'normal'); doc.setFontSize(size); const max = c.w * k - 3; while (s.length > 3 && doc.getTextWidth(s) > max) s = s.slice(0, -2); if (s !== clean(o.v ?? '')) s = s.slice(0, -1) + '...';
        doc.setTextColor(...(flag === 3 ? RED : flag === 2 ? AMBER : NAVY)); doc.text(s, c.a === 'r' ? xs[i] + c.w * k - 1.5 : xs[i] + 1.5, y + rh - 1.6, { align: c.a === 'r' ? 'right' : 'left' }); });
      y += rh; });
    doc.setDrawColor(...LINE); doc.line(M, y, W - M, y); y += 5;
  }

  // header
  if (ioLogo) doc.addImage(ioLogo, 'PNG', M, 10, 20.8, 28);
  doc.setFillColor(...NAVY); doc.roundedRect(W - M - 30, 12, 30, 20, 2, 2, 'F'); if (adLogo) doc.addImage(adLogo, 'PNG', W - M - 23.5, 15.2, 17, 12.6); text('Aqua Development', W - M - 15, 36.4, { s: 6.5, c: GREY, a: 'center' });
  text('AquaDev shrimp farm, Abu Dhabi', 42, 17, { s: 9, c: GREY }); text(T.name, 42, 25.5, { b: 1, s: 18 });
  text(type === 'status' ? `Data round ${fD.format(D.slotOf(t))}` : `${fD.format(tA)} to ${fD.format(t)} (Gulf Standard Time)`, 42, 31.5, { s: 9.5 });
  text(`Issued ${fDT.format(Date.now())} by ${session.name}`, 42, 36.4, { s: 8, c: GREY });
  doc.setDrawColor(...IO); doc.setLineWidth(0.7); doc.line(M, 42, W - M, 42); doc.setLineWidth(0.2); y = 48;
  if (sample) { doc.setFillColor(255, 244, 214); doc.roundedRect(M, y, W - 2 * M, 9, 1.5, 1.5, 'F'); text('This report includes generated sample history. It is not a record of the farm until Aqua Development submits real data rounds.', M + 3, y + 5.7, { s: 8, c: AMBER, b: 1 }); y += 13; }
  else if (fr.live && last) { para(`Latest data round: ${fD.format(last.t)}, entered by ${last.by || 'Aqua Development'} at ${fD.format(last.at || last.t)}. ${got} of ${exp} expected rounds were received in this period.${exp - got > 0 ? ` ${exp - got} missing.` : ''}`, NAVY); }

  // summary tiles
  const tiles = [['Tanks in grow-out', `${farm.grow} of 28`], ['Standing biomass', `${num(farm.biomass / 1000, 2)} t`], [type === 'status' ? 'Feed, last 24 h' : 'Feed in period', `${num(type === 'status' ? farm.feed : feed, 0)} kg`], ['Harvest in period', hv.length ? `${num(hv.reduce((s, h) => s + h.kg, 0), 0)} kg` : 'None'],
    ['Open alarms', open.length ? `${open.length} (${open.filter(a => a.sev >= 3).length} critical)` : 'None'], ['Electrical load', farm.power.total == null ? 'Not entered' : `${num(farm.power.total, 0)} kW`], ['Hall air', farm.climate.room == null ? 'Not entered' : `${num(farm.climate.room, 1)} °C`], ['Rounds received', sample && !exp ? 'Sample' : `${got} of ${exp}`]];
  const bw = (W - 2 * M - 9) / 4; tiles.forEach((tl, i) => { const x = M + (i % 4) * (bw + 3), yy = y + Math.floor(i / 4) * 17; doc.setFillColor(...PALE); doc.roundedRect(x, yy, bw, 14.5, 1.5, 1.5, 'F'); text(tl[0], x + 3, yy + 5, { s: 7.3, c: GREY }); text(tl[1], x + 3, yy + 11.6, { b: 1, s: 12.5 }); }); y += 38;
  if (shot) { const ih = Math.min(86, (W - 2 * M) * shot.h / shot.w); need(ih + 8); doc.addImage(shot.url, 'JPEG', M, y, W - 2 * M, ih); y += ih + 2; text('Digital twin at the time of the report. Tank colour shows open alarms.', M, y + 3, { s: 7.5, c: GREY }); y += 8; }

  h2('Alarms');
  if (!recorded.length) para('No alarm was recorded or open in this period.');
  else table([{ h: 'Happened', w: 28 }, { h: 'Where', w: 26 }, { h: 'Severity', w: 18 }, { h: 'Alarm', w: 62 }, { h: 'Recorded by', w: 26 }, { h: 'Status', w: 34 }], recorded.map(a => [fD.format(a.t), D.areaName(a), { v: D.SEV[a.sev], f: a.sev }, a.type, a.by || '', a.status === 'resolved' && a.rt <= t ? 'Resolved ' + fD.format(a.rt) : { v: 'Open', f: a.sev }]));
  const dot = x => String(x).trim().replace(/[.\s]+$/, '');
  for (const a of recorded.slice(0, 14)) { const bits = [a.text && dot(a.text), a.action && 'Action taken: ' + dot(a.action), a.rnote && a.rt <= t && 'Resolution: ' + dot(a.rnote)].filter(Boolean); if (bits.length) para(`${D.areaName(a)}, ${a.type.toLowerCase()}. ${bits.join('. ')}.`); }

  h2('Readings outside limits');
  if (!alarms.length) para('Every stocked tank is inside its warning limits.');
  else table([{ h: 'Tank', w: 16 }, { h: 'Reading', w: 62 }, { h: 'Warning limits', w: 44 }, { h: 'Severity', w: 22 }, { h: 'Round', w: 30 }], alarms.map(a => { const Lm = LIMITS[a.param]; return [`Tank ${a.tank}`, { v: a.text, f: a.sev }, Lm ? `${Lm.lo1 > Lm.min ? Lm.lo1 : 'none'} to ${Lm.hi1} ${Lm.unit}` : `max ${DENSITY_LIMIT} kg/m2`, { v: D.SEV[a.sev], f: a.sev }, a.at ? fD.format(a.at) : '']; }));

  h2('Tank status');
  const cell = (x, p) => !x.r.wet || !x.st.stocked || x.r[p] == null ? '' : { v: num(x.r[p], LIMITS[p].dp), f: D.severity(p, x.r[p]) >= 2 ? D.severity(p, x.r[p]) : 0 };
  table([{ h: 'Tank', w: 13 }, { h: 'Status', w: 22 }, { h: 'Day', w: 9, a: 'r' }, { h: 'Weight g', w: 14, a: 'r' }, { h: 'Population', w: 18, a: 'r' }, { h: 'Biomass kg', w: 17, a: 'r' }, { h: 'kg/m2', w: 12, a: 'r' }, { h: 'DO', w: 11, a: 'r' }, { h: 'Temp', w: 11, a: 'r' }, { h: 'pH', w: 11, a: 'r' }, { h: 'Salinity', w: 13, a: 'r' }, { h: 'TAN', w: 11, a: 'r' }, { h: 'Feed 24 h', w: 15, a: 'r' }],
    snap.map(x => x.st.stocked ? [{ v: x.tk.name, b: 1 }, x.st.short, Math.floor(x.st.doc), num(x.st.weight, 1), num(x.st.count, 0), num(x.st.biomass, 0), { v: num(x.st.density, 2), f: x.st.density > DENSITY_LIMIT ? 2 : 0 }, cell(x, 'do'), cell(x, 'temp'), cell(x, 'ph'), cell(x, 'sal'), cell(x, 'tan'), num(x.st.feedToday, 1)] : [{ v: x.tk.name, b: 1 }, x.st.short, '', '', '', '', '', '', '', '', '', '', '']));
  para('Units: DO and TAN in mg/L, temperature in °C, salinity in ppt. Amber cells are past a warning limit, red cells past a critical limit.');

  if (type !== 'status') { const ev = D.eventLog(tA, t).filter(e => e.kind !== 'round'); h2('Events in this period');
    if (!ev.length) para('No events were recorded in this period.'); else table([{ h: 'Time', w: 30 }, { h: 'Tank', w: 16 }, { h: 'Type', w: 22 }, { h: 'Event', w: 106 }], ev.slice(0, 120).map(e => [fD.format(e.t), e.where || (e.tank ? `Tank ${e.tank}` : ''), e.kind === 'alarm' ? { v: 'Alarm', f: e.sev } : e.kind === 'resolved' ? 'Resolved' : 'Operation', e.text + (e.src === 'sample' ? ' (sample)' : '')])); }

  if (type === 'monthly') { const months = D.monthlyKpis(t), done = months.filter(m => !m.future), agg = k => { const d = KPI_TARGETS[k], v = done.map(m => m[k]).filter(q => q != null); if (!v.length) return null; return d.agg === 'sum' ? v.reduce((a, b) => a + b, 0) : d.agg === 'max' ? Math.max(...v) : v.reduce((a, b) => a + b, 0) / v.length; };
    const f = (k, v) => v == null ? '' : KPI_TARGETS[k].pct ? num(v * 100, 0) + ' %' : num(v, Math.abs(v) < 100 && !Number.isInteger(v) ? 2 : 0);
    h2(`KPI follow-up, month ${done.length} of 12`); table([{ h: 'KPI', w: 60 }, { h: 'Unit', w: 24 }, { h: 'First-year target', w: 30, a: 'r' }, { h: 'Full capacity', w: 30, a: 'r' }, { h: 'Realised to date', w: 30, a: 'r' }],
      Object.keys(KPI_TARGETS).filter(k => KPI_TARGETS[k].agg !== 'derived').map(k => { const d = KPI_TARGETS[k]; return [d.label, d.unit, f(k, d.first), f(k, d.full), { v: f(k, agg(k)), b: 1 }]; }));
    para('Targets are those of the AquaDev KPI follow-up workbook. Realised figures count from the start of operations.'); }

  h2('Data rounds in this period');
  table([{ h: 'Round', w: 36 }, { h: 'Status', w: 24 }, { h: 'Entered by', w: 34 }, { h: 'Submitted', w: 30 }, { h: 'Note', w: 50 }], rounds.slice(-32).reverse().map(r => [fD.format(r.slot), r.round ? 'Received' : r.expected ? { v: 'Missing', f: 3 } : 'Sample', r.round ? r.round.by || '' : '', r.round ? fD.format(r.round.at || r.round.t) : '', r.round ? r.round.note || '' : '']));
  need(22); y += 4; doc.setDrawColor(...LINE); doc.line(M, y + 12, M + 70, y + 12); doc.line(W - M - 70, y + 12, W - M, y + 12); text(`Prepared by ${session.name}`, M, y + 16, { s: 8, c: GREY }); text('Reviewed by', W - M - 70, y + 16, { s: 8, c: GREY });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setDrawColor(...LINE); doc.line(M, H - 13, W - M, H - 13); text('AquaDev shrimp farm monitoring platform. Innovation Oasis with Aqua Development.', M, H - 8.5, { s: 7, c: GREY }); text(`Page ${p} of ${pages}`, W - M, H - 8.5, { s: 7, c: GREY, a: 'right' }); if (sample) text('Contains sample data', W / 2 + 30, H - 8.5, { s: 7, c: AMBER, b: 1, a: 'center' }); }
  const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).format(t).replace(/[^0-9]+/g, '-').replace(/-$/, '');
  return { blob: doc.output('blob'), name: `AquaDev-${type}-report-${stamp}.pdf`, pages, alarms: open.length, sample };
}
