// entry.js — Aqua Development's 6-hourly data round: one row per tank, farm meters, stocking and harvest events.
import { TANKS, LIMITS } from './model.js';
import * as D from './data.js';
import { $, $$, esc, num, toast, chip } from './ui.js';
import { fmtDateTime, fmtTime, fmtDate } from './charts.js';

const COLS = [['w', 'Avg weight', 'g'], ['n', 'Population', 'shrimp'], ['feed', 'Feed given', 'kg'], ['mort', 'Mortalities', 'count'], ['do', 'DO', 'mg/L'], ['temp', 'Temp', '°C'], ['ph', 'pH', ''], ['sal', 'Salinity', 'ppt'], ['tan', 'TAN', 'mg/L'], ['no2', 'Nitrite', 'mg/L'], ['alk', 'Alkalinity', 'mg/L'], ['level', 'Depth', 'm']];
const FARMF = [['kwhProd', 'Electricity, production equipment', 'kWh used in the 6 hours'], ['kwhOther', 'Electricity, everything else', 'kWh used in the 6 hours'], ['roomT', 'Hall air temperature', '°C, limit 35'], ['roomRh', 'Hall humidity', '% RH'], ['wt1', 'Water treatment Tank 1 level', '% full'], ['wt2', 'Water treatment Tank 2 level', '% full']];
const WQ = new Set(D.PARAMS), cur = { slot: null, draft: null, events: [], prev: null };
export const slotName = s => { const e = fmtTime(s + D.SLOT); return `${fmtDate(s)}, ${fmtTime(s)} to ${e === '00:00' ? '24:00' : e}`; };
const parse = v => { const s = String(v ?? '').trim().replace(',', '.'); if (s === '') return null; const n = Number(s); return isFinite(n) && n >= 0 ? n : NaN; };

function begin(slot) {
  const ex = D.roundFor(slot), prev = D.previousFor(slot); cur.slot = slot; cur.prev = prev; cur.events = [];
  cur.draft = ex ? JSON.parse(JSON.stringify({ note: ex.note || '', farm: ex.farm || {}, tanks: ex.tanks })) : { note: '', farm: {}, tanks: Object.fromEntries(TANKS.map(t => [t.id, { s: prev[t.id].s, w: prev[t.id].w, n: prev[t.id].n }])) };
}
function tally() {
  let filled = 0, need = 0, bad = 0, invalid = 0;
  for (const t of TANKS) { const x = cur.draft.tanks[t.id]; if (x.s !== 'grow') continue; for (const p of D.PARAMS) { need++; const v = x[p]; if (v == null) continue; if (Number.isNaN(v)) { invalid++; continue; } filled++; if (D.severity(p, v) >= 2) bad++; } }
  for (const t of TANKS) for (const [f] of COLS) if (Number.isNaN(cur.draft.tanks[t.id][f])) invalid += WQ.has(f) && cur.draft.tanks[t.id].s === 'grow' ? 0 : 1;
  for (const [f] of FARMF) if (Number.isNaN(cur.draft.farm[f])) invalid++;
  return { filled, need, bad, invalid };
}
function cellClass(f, v, s) { if (Number.isNaN(v)) return 'bad'; if (v == null || !WQ.has(f) || s !== 'grow') return ''; const sv = D.severity(f, v); return sv === 3 ? 'c' : sv === 2 ? 'w' : ''; }
function summary(root) {
  const t = tally(), el = $('#en-sum', root); if (!el) return;
  el.innerHTML = `<b>${t.filled} of ${t.need}</b> water readings filled${t.bad ? `, <b class="warn">${t.bad} outside limits</b>` : ''}${t.invalid ? `, <b class="err">${t.invalid} not a valid number</b>` : ''}`;
  $('#en-submit', root).disabled = t.invalid > 0;
}

export function renderEntry(root, ctx) {
  const now = Date.now(), nowSlot = D.slotOf(now); if (cur.slot == null || ctx.reset) begin(ctx.slot ?? cur.slot ?? nowSlot);
  const ex = D.roundFor(cur.slot), fr = D.freshness(now), d = cur.draft, slots = []; for (let k = 0; k < 8; k++) slots.push(nowSlot - k * D.SLOT);
  root.innerHTML = `<div class="cards one">
    <div class="card"><div class="card-h row-h"><div><h2>Data round, ${slotName(cur.slot)}</h2><p>${ex ? `Submitted ${fmtDateTime(ex.at || ex.t)} by ${esc(ex.by || 'AD')}. Saving again replaces it.` : cur.slot === nowSlot ? `Due now. The next round opens at ${fmtTime(nowSlot + D.SLOT)}.` : 'This earlier round was not submitted. You can still enter it.'}</p></div>
      <label class="fld slim">Round<select id="en-slot">${slots.map(s => `<option value="${s}" ${s === cur.slot ? 'selected' : ''}>${slotName(s)}${D.roundFor(s) ? ' — submitted' : s === nowSlot ? ' — due' : ' — missing'}</option>`).join('')}</select></label></div>
      ${fr.sample ? `<p class="banner">The platform is showing sample history. Your first submitted round starts the real record; Innovation Oasis will see your values from that round on.</p>` : ''}
      <div class="farm-grid">${FARMF.map(([f, l, u]) => `<label class="fld">${l}<input class="num" inputmode="decimal" data-farm="${f}" value="${d.farm[f] ?? ''}" placeholder="${cur.prev.farm[f] ?? ''}"><small>${u}</small></label>`).join('')}</div></div>
    <div class="card"><div class="card-h row-h"><div><h2>Tank readings</h2><p>Grey figures are the last round. Type the new value, press Enter to move down, or paste a block copied from Excel. Cells turn amber or red when a reading is outside its limits.</p></div>
      <button class="btn ghost" data-en="carry">Copy the last round into empty cells</button></div>
      <div class="scroll"><table class="entry"><thead><tr><th>Tank</th><th>Status</th>${COLS.map(([f, l, u]) => `<th>${l}${u ? `<small>${u}</small>` : ''}</th>`).join('')}</tr></thead><tbody>
      ${TANKS.map(t => { const x = d.tanks[t.id], dry = x.s === 'clean' || x.s === 'idle'; return `<tr data-row="${t.id}" class="${dry ? 'dry' : ''}"><th>${t.name}</th><td><select data-t="${t.id}" data-f="s">${Object.entries(D.STATUS).map(([k, v]) => `<option value="${k}" ${x.s === k ? 'selected' : ''}>${v[1]}</option>`).join('')}</select></td>
        ${COLS.map(([f]) => `<td><input class="num ${cellClass(f, x[f], x.s)}" inputmode="decimal" data-t="${t.id}" data-f="${f}" value="${x[f] == null || Number.isNaN(x[f]) ? '' : x[f]}" placeholder="${cur.prev[t.id][f] ?? ''}" ${dry ? 'disabled' : ''} aria-label="${t.name} ${f}"></td>`).join('')}</tr>`; }).join('')}</tbody></table></div></div>
    <div class="card"><div class="card-h"><h2>Stocking and harvest in this period</h2><p>Record each stocking or harvest once. They drive the cycle day, survival and the production KPIs.</p></div>
      <div class="row"><label class="fld slim">Event<select id="ev-type"><option value="harvest">Harvest</option><option value="stock">Stocking</option></select></label><label class="fld slim">Tank<select id="ev-tank">${TANKS.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select></label>
        <label class="fld slim" id="ev-kg-w">Harvested, kg<input class="num" id="ev-kg" inputmode="decimal"></label><label class="fld slim" id="ev-size-w">Average size, g<input class="num" id="ev-size" inputmode="decimal"></label><label class="fld slim" id="ev-n-w" hidden>Juveniles stocked<input class="num" id="ev-n" inputmode="numeric"></label><button class="btn" data-en="add-ev">Add event</button></div>
      <ul class="evlist" id="ev-list">${evList()}</ul></div>
    <div class="card submit"><label class="fld grow">Note for Innovation Oasis (optional)<textarea id="en-note" rows="2" placeholder="Anything unusual in this period">${esc(d.note)}</textarea></label>
      <div class="submit-r"><p id="en-sum"></p><button class="btn primary big" id="en-submit" data-en="submit">${ex ? 'Save changes to this round' : 'Submit round'}</button></div></div></div>`;
  summary(root);
  if (root.dataset.bound) return; root.dataset.bound = '1';
  root.addEventListener('input', e => { const el = e.target;
    if (el.dataset.farm) { cur.draft.farm[el.dataset.farm] = parse(el.value); el.classList.toggle('bad', Number.isNaN(cur.draft.farm[el.dataset.farm])); }
    else if (el.dataset.t && el.dataset.f !== 's') { const x = cur.draft.tanks[el.dataset.t], v = parse(el.value); x[el.dataset.f] = v; el.className = 'num ' + cellClass(el.dataset.f, v, x.s); }
    else if (el.id === 'en-note') cur.draft.note = el.value;
    summary(root); });
  root.addEventListener('change', e => { const el = e.target;
    if (el.id === 'en-slot') { begin(+el.value); renderEntry(root, ctx); }
    else if (el.dataset.f === 's') { cur.draft.tanks[el.dataset.t].s = el.value; renderEntry(root, ctx); }
    else if (el.id === 'ev-type') { const st = el.value === 'stock'; $('#ev-n-w', root).hidden = !st; $('#ev-kg-w', root).hidden = st; $('#ev-size-w', root).hidden = st; } });
  root.addEventListener('keydown', e => { const el = e.target; if (!el.dataset || !el.dataset.t || el.tagName !== 'INPUT') return; const dir = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0; if (!dir) return;
    e.preventDefault(); let id = +el.dataset.t; for (let k = 0; k < 28; k++) { id += dir; const nx = $(`input[data-t="${id}"][data-f="${el.dataset.f}"]`, root); if (!nx) break; if (!nx.disabled) { nx.focus(); nx.select(); break; } } });
  root.addEventListener('paste', e => { const el = e.target; if (!el.dataset || !el.dataset.t || el.dataset.f === 's') return; const text = (e.clipboardData || window.clipboardData).getData('text'); if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault(); const c0 = COLS.findIndex(c => c[0] === el.dataset.f); text.replace(/\r/g, '').split('\n').filter(l => l.length).forEach((line, r) => line.split('\t').forEach((cell, c) => { const col = COLS[c0 + c], x = cur.draft.tanks[+el.dataset.t + r]; if (col && x && x.s !== 'clean' && x.s !== 'idle') x[col[0]] = parse(cell); }));
    renderEntry(root, ctx); toast('Pasted values filled in. Check them before you submit.'); });
  root.addEventListener('click', e => { const b = e.target.closest('[data-en]'); if (!b) return; const a = b.dataset.en;
    if (a === 'carry') { let n = 0; for (const t of TANKS) { const x = cur.draft.tanks[t.id]; if (x.s === 'clean' || x.s === 'idle') continue; for (const p of D.PARAMS) if (x[p] == null && cur.prev[t.id][p] != null) { x[p] = cur.prev[t.id][p]; n++; } }
      for (const [f] of FARMF) if (cur.draft.farm[f] == null && cur.prev.farm[f] != null) { cur.draft.farm[f] = cur.prev.farm[f]; n++; } renderEntry(root, ctx); toast(n ? `${n} empty cells filled from the last round. Overwrite any that changed.` : 'There were no empty cells to fill.'); }
    else if (a === 'add-ev') { const type = $('#ev-type', root).value, tank = +$('#ev-tank', root).value, kg = parse($('#ev-kg', root).value), size = parse($('#ev-size', root).value), n = parse($('#ev-n', root).value);
      if (type === 'harvest' ? !(kg > 0) : !(n > 0)) return toast(type === 'harvest' ? 'Enter the harvested weight in kg.' : 'Enter the number of juveniles stocked.', 'err');
      cur.events.push(type === 'harvest' ? { type, tank, kg, size: size > 0 ? size : null } : { type, tank, n }); $('#ev-list', root).innerHTML = evList(); for (const id of ['ev-kg', 'ev-size', 'ev-n']) $('#' + id, root).value = ''; }
    else if (a === 'del-ev') { cur.events.splice(+b.dataset.i, 1); $('#ev-list', root).innerHTML = evList(); }
    else if (a === 'submit') { const t = tally(); if (t.invalid) return toast('Fix the cells marked in red outline before submitting.', 'err');
      const at = Date.now(), clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && !Number.isNaN(v)));
      const ok = D.submitRound({ t: cur.slot, at, by: ctx.session.name, note: cur.draft.note.trim(), farm: clean(cur.draft.farm), tanks: Object.fromEntries(TANKS.map(tk => [tk.id, clean(cur.draft.tanks[tk.id])])) });
      for (const ev of cur.events) D.addEvent({ ...ev, t: Math.min(at, cur.slot + D.SLOT - 1), by: ctx.session.name });
      if (!ok) return toast('The round could not be saved: this browser refused storage.', 'err');
      toast(`Round for ${slotName(cur.slot)} saved${t.bad ? ` with ${t.bad} readings outside limits` : ''}.`, 'ok'); begin(cur.slot); ctx.onSaved && ctx.onSaved(); renderEntry(root, ctx); } });
}
function evList() { return cur.events.length ? cur.events.map((e, i) => `<li>${chip(0, e.type === 'harvest' ? 'Harvest' : 'Stocking')}<span>Tank ${e.tank}: ${e.type === 'harvest' ? `${num(e.kg, 0)} kg${e.size ? ' at ' + num(e.size, 1) + ' g' : ''}` : `${num(e.n, 0)} juveniles`}</span><button class="link" data-en="del-ev" data-i="${i}">Remove</button></li>`).join('') : '<li class="q">No events added for this round.</li>'; }

export function openSlot(slot) { begin(slot); }
export function renderHistory(root, ctx) {
  const now = Date.now(), nowSlot = D.slotOf(now), fr = D.freshness(now), rows = []; for (let k = 0; k < 28; k++) rows.push(nowSlot - k * D.SLOT);
  const log = D.eventLog(nowSlot - 28 * D.SLOT, now).filter(e => e.kind === 'round');
  root.innerHTML = `<div class="cards one"><div class="card"><div class="card-h"><h2>Rounds of the last 7 days</h2><p>${fr.live ? 'Four rounds are expected each day, at 00:00, 06:00, 12:00 and 18:00 Gulf Standard Time.' : 'No real round has been submitted yet. The platform is showing sample history.'}</p></div>
    <table class="grid-t"><thead><tr><th>Round</th><th>Status</th><th>Entered by</th><th>Submitted</th><th class="r">Empty readings</th><th class="r">Outside limits</th><th>Note</th><th></th></tr></thead><tbody>
    ${rows.map(s => { const r = D.roundFor(s), l = log.find(e => e.slot === s), late = !r && fr.live && s >= D.getDb().liveFrom; return `<tr><td><b>${slotName(s)}</b></td><td>${r ? chip(0, 'Submitted') : s === nowSlot ? chip(fr.overdue ? 2 : 1, fr.overdue ? 'Overdue' : 'Due') : late ? chip(3, 'Missing') : '<span class="q">Before records began</span>'}</td><td>${r ? esc(r.by || '') : ''}</td><td>${r ? fmtDateTime(r.at || r.t) : ''}</td><td class="r">${l ? l.blank : ''}</td><td class="r${l && l.bad ? ' sv2' : ''}">${l ? l.bad : ''}</td><td>${r && r.note ? esc(r.note) : ''}</td><td class="r">${ctx.canEnter ? `<button class="btn sm" data-open-slot="${s}">${r ? 'Amend' : 'Enter'}</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div></div>`;
}
