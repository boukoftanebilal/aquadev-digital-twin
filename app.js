// app.js — sign-in, the application shell, the digital twin page, the tank table and the tank panel.
import { FARM, TANKS, LIMITS, DENSITY_LIMIT, TANK_SPEC } from './model.js';
import * as D from './data.js';
import * as A from './auth.js';
import { lineChart, spark, initHover, showTip, fmtTime, fmtDate, fmtDateTime } from './charts.js';
import { $, $$, num, esc, chip, phaseChip, rangeBar, stat, srcTag, tankVisual, legendHtml, MODES, planSvg, toast } from './ui.js';
import { V } from './views.js';
import { renderEntry, renderHistory, openSlot, slotName } from './entry.js';

const DAY = D.DAY, HOUR = D.HOUR;
const MON = [['twin', 'Digital twin'], ['tanks', 'Tanks'], ['water', 'Water'], ['production', 'Production and KPIs'], ['energy', 'Energy and climate'], ['alarms', 'Alarms and log'], ['reports', 'Reports'], ['facility', 'Facility']];
const NAV = { io: [...MON, ['data', 'Data file'], ['account', 'My account']],
  ad: [['entry', 'Update data'], ['history', 'Round history'], ['alarms', 'Alarms and log'], ['twin', 'Digital twin'], ['tanks', 'Tanks'], ['data', 'Data file'], ['account', 'My account']],
  superadmin: [...MON, ['entry', 'Update data'], ['history', 'Round history'], ['users', 'Users'], ['data', 'Data file'], ['account', 'My account']] };
const state = { view: null, sel: null, colorBy: 'status', param: 'do', sort: 'id', t: null, acks: new Set(), hoverChart: false, session: null,
  layers: { labels: true, piping: true, sensors: true, structure: true, grid: false, campus: true } };
let twin = null, snap = null, lastFull = 0;
const viewT = () => state.t ?? Date.now();

function snapshot(t) {
  const alarms = D.alarmsAt(t), tanks = new Map(); for (const tk of TANKS) { const { sev, flag, r } = D.tankSeverity(tk.id, t, alarms); tanks.set(tk.id, { tk, r, st: r.st, sev, flag }); }
  return { t, tanks, farm: D.farm(t), alarms, flags: D.flagsAt(t), wt: D.wtState(t), fresh: D.freshness(Date.now()) };
}

// ---- tank panel ------------------------------------------------------------------------
function inspectorHtml() {
  const t = snap.t;
  if (!state.sel) { const f = snap.farm, crit = snap.alarms.filter(a => a.sev >= 3).length, v = (x, dp, u) => x == null ? 'Not entered' : num(x, dp) + u;
    return `<header><h2>Grow-out hall</h2><p>28 tanks of 100 m² on a ${FARM.block.w} × ${FARM.block.d} m slab. Select a tank in the model or in the list to open it.</p></header>
      <div class="stats two">${stat('Tanks in grow-out', f.grow + ' of 28')}${stat('Shrimp in water', num(f.count / 1e6, 2) + ' M')}${stat('Standing biomass', num(f.biomass / 1000, 2) + ' t')}${stat('Feed, last 24 h', num(f.feed, 0) + ' kg')}
      ${stat('Electrical load', v(f.power.total, 0, ' kW'))}${stat('Hall air', v(f.climate.room, 1, ' °C'), f.climate.rh == null ? '' : num(f.climate.rh * 100, 0) + ' % RH')}</div>
      <h3>Next harvests</h3><table class="mini"><tbody>${[...snap.tanks.values()].filter(x => x.st.stocked).sort((a, b) => a.st.harvestAt - b.st.harvestAt).slice(0, 6).map(x => `<tr data-tank="${x.tk.id}"><td>${x.tk.name}</td><td>${fmtDate(x.st.harvestAt)}</td><td class="r">${num(x.st.daysToHarvest, 0)} d</td><td class="r">${num(x.st.projHarvestKg, 0)} kg</td></tr>`).join('') || '<tr><td class="q">No tank is in grow-out.</td></tr>'}</tbody></table>
      <h3>Open alarms</h3>${snap.alarms.length ? `<ul class="alist">${snap.alarms.slice(0, 6).map(a => `<li ${a.tank ? `data-tank="${a.tank}"` : 'data-go="alarms"'}>${chip(a.sev, D.areaName(a))}<span>${esc(a.type)}</span></li>`).join('')}</ul>` : '<p class="quiet">No alarm is open.</p>'}
      <p class="quiet">${snap.flags.length ? `${snap.flags.length} reading${snap.flags.length > 1 ? 's are' : ' is'} outside limits in this round.` : 'Every reading of this round is inside its limits.'}</p>`; }
  const x = snap.tanks.get(state.sel), tk = x.tk, st = x.st, r = x.r, L = LIMITS[state.param];
  let body = '';
  if (st.stocked) {
    const prog = Math.min(100, st.doc / D.CFG.growDays * 100), gs = D.growthSeries(tk.id, t);
    body += `<div class="prog"><div style="width:${prog}%"></div></div><p class="progl"><span>Cycle ${st.cycle}, day ${Math.floor(st.doc)} of ${D.CFG.growDays}</span><span>Harvest ${fmtDate(st.harvestAt)}</span></p>
      <div class="stats two">${stat('Average weight', num(st.weight, 1) + ' g', num(st.growthNow, 2) + ' g/week')}${stat('Population', num(st.count, 0), num(st.survival * 100, 1) + ' % survival')}
      ${stat('Biomass', num(st.biomass, 0) + ' kg', num(st.density, 2) + ' kg/m²' + (st.density > DENSITY_LIMIT ? ' — over limit' : ''))}${stat('Feed, last 24 h', num(st.feedToday, 1) + ' kg', num(st.feedRate * 100, 1) + ' % of biomass')}
      ${stat('Feed this cycle', num(st.feedCum, 0) + ' kg', 'FCR to date ' + num(st.fcrToDate, 2))}${stat('Projected harvest', num(st.projHarvestKg, 0) + ' kg', num(st.projDensity, 2) + ' kg/m²' + (st.projDensity > DENSITY_LIMIT ? ' — over limit' : ''))}</div>
      <h3>Water quality</h3><table class="wq"><tbody>${D.PARAMS.map(p => { const sv = D.severity(p, r[p]); return `<tr class="${state.param === p ? 'on' : ''}" data-param="${p}"><td>${LIMITS[p].label}</td><td class="r">${r[p] == null ? '<span class="q">not measured</span>' : `<b>${num(r[p], LIMITS[p].dp)}</b> ${LIMITS[p].unit.replace(' CaCO₃', '')}`}</td><td>${rangeBar(p, r[p])}</td><td>${sv >= 2 ? `<span class="flag f${sv}" title="${D.SEV[sv]}">${sv === 3 ? '×' : '!'}</span>` : ''}</td></tr>`; }).join('')}</tbody></table>
      <h3>${L.label}, last 7 days</h3>${lineChart({ title: L.label, series: [{ name: L.label, color: '#2a78d6', pts: D.series(tk.id, state.param, t - 7 * DAY, t) }], time: true, unit: L.unit, dp: L.dp, w: 338, h: 170,
        bands: [{ from: L.t0, to: L.t1, cls: 'ok' }], rules: [L.lo1 > L.min ? { y: L.lo1, label: 'low warning' } : null, { y: L.hi1, label: 'high warning' }].filter(q => q && r[state.param] != null && Math.abs(q.y - r[state.param]) < (L.max - L.min) * 0.35) })}
      ${gs ? `<h3>Growth against the 1.7 g/week target</h3>${lineChart({ title: 'Growth', series: [{ name: 'Target', color: '#8a97a5', pts: gs.target, dash: true }, { name: 'This cycle', color: '#2a78d6', pts: gs.actual }], xLabel: 'Day', unit: 'g', dp: 1, w: 338, h: 170, zero: true })}` : ''}`;
  } else {
    body += `<p class="phase-note">${esc(st.label)}.${st.nextStockAt && st.phase !== 'idle' ? ` Next stocking planned ${fmtDate(st.nextStockAt)}.` : ''}${st.lastHarvestKg ? ` Last harvest ${num(st.lastHarvestKg, 0)} kg.` : ''}</p>
      ${r.wet ? `<div class="stats two">${stat('Water depth', r.level == null ? '—' : num(r.level, 2) + ' m')}${stat('Temperature', r.temp == null ? '—' : num(r.temp, 1) + ' °C')}${stat('Salinity', r.sal == null ? '—' : num(r.sal, 1) + ' ppt')}${stat('pH', r.ph == null ? '—' : num(r.ph, 2))}</div>` : ''}`;
  }
  const mine = snap.alarms.filter(a => a.tank === tk.id);
  body = (mine.length ? `<ul class="alist boxed">${mine.map(a => `<li data-go="alarms">${chip(a.sev, D.SEV[a.sev] + ' alarm')}<span><b>${esc(a.type)}</b>${a.text ? ' — ' + esc(a.text) : ''}</span></li>`).join('')}</ul>` : '') + body;
  body += `<h3>Source of these values</h3><p class="srcline">${r.src === 'entered' ? `Round ${slotName(r.at)}, entered by ${esc(r.by || 'Aqua Development')}.` : r.src === 'sample' ? 'Generated sample history. Aqua Development has not submitted a real round for this time.' : 'No data has been entered for this tank.'}</p>
    <div class="row"><button class="btn" data-act="focus">Show in the twin</button>${A.can.alarm(state.session.role) ? '<button class="btn ghost" data-go="alarms">Record an alarm</button>' : ''}</div>`;
  return `<header><button class="x" data-act="close" aria-label="Close tank panel">×</button><h2>${tk.name}</h2><p>${tk.tag}, grid ${tk.grid}, ${TANK_SPEC.footprint} m², centre drain Ø${TANK_SPEC.drainDia} m</p>${phaseChip(x)} ${srcTag(r.src)}</header>${body}`;
}

// ---- pages owned by this file ------------------------------------------------------------
V.twin = { title: 'Digital twin', render(root, ctx, full) {
  if (twin) { const m = new Map(); for (const [id, x] of snap.tanks) m.set(id, tankVisual(x, state.colorBy)); twin.update(m, snap.wt.tanks.map(w => w.frac)); }
  else if (full) $('#twin-host').innerHTML = `<div class="fallback"><p>The 3D view is unavailable in this browser (WebGL could not start). The plan is shown instead.</p>${planSvg(snap, { h: 520, sel: state.sel, colorBy: state.colorBy })}</div>`;
  const f = snap.farm, crit = snap.alarms.filter(a => a.sev >= 3).length;
  $('#ribbon').innerHTML = stat('Standing biomass', num(f.biomass / 1000, 2) + ' t') + stat('In grow-out', f.grow + ' of 28') + stat('Feed, last 24 h', num(f.feed, 0) + ' kg') + stat('Load', f.power.total == null ? '—' : num(f.power.total, 0) + ' kW')
    + stat('Next harvest', f.next ? 'Tank ' + f.next.tank : '—', f.next ? fmtDate(f.next.at) + ', ' + num(f.next.kg, 0) + ' kg' : '') + stat('Open alarms', String(snap.alarms.length), crit ? crit + ' critical' : snap.flags.length ? snap.flags.length + ' readings outside limits' : 'none critical');
  if (full) { $('#inspector').innerHTML = inspectorHtml(); $('#legend').innerHTML = legendHtml(state.colorBy); }
} };
V.tanks = { title: 'Tanks', render(root) {
  const cols = [['id', 'Tank'], ['status', 'Status'], ['doc', 'Day'], ['weight', 'Weight, g'], ['count', 'Population'], ['biomass', 'Biomass, kg'], ['density', 'kg/m²'], ['do', 'DO, mg/L'], ['temp', 'Temp, °C'], ['ph', 'pH'], ['tan', 'TAN, mg/L'], ['feed', 'Feed 24 h, kg'], ['harvest', 'Harvest']];
  const val = (x, k) => ({ id: x.tk.id, status: -x.sev * 100 + (x.st.stocked ? 0 : 50), doc: x.st.doc ?? -1, weight: x.st.weight, count: x.st.count, biomass: x.st.biomass, density: x.st.density, do: x.r.do ?? 99, temp: x.r.temp ?? 0, ph: x.r.ph ?? 0, tan: x.r.tan ?? 0, feed: x.st.feedToday, harvest: x.st.stocked ? x.st.harvestAt : 9e15 }[k]);
  const rows = [...snap.tanks.values()].sort((a, b) => val(a, state.sort) - val(b, state.sort));
  const cell = (x, p) => { if (!x.r.wet || !x.st.stocked || x.r[p] == null) return '<td class="r q">—</td>'; const sv = D.severity(p, x.r[p]); return `<td class="r${sv >= 2 ? ' sv' + sv : ''}">${num(x.r[p], LIMITS[p].dp)}</td>`; };
  root.innerHTML = `<div class="split"><div class="card grow"><div class="card-h"><h2>All grow-out tanks</h2><p>Select a row to open the tank. Select a column heading to sort.</p></div><div class="scroll"><table class="grid-t"><thead><tr>${cols.map(c => `<th data-sort="${c[0]}" class="${state.sort === c[0] ? 'on' : ''}">${c[1]}</th>`).join('')}<th>DO, 7 days</th></tr></thead><tbody>
    ${rows.map(x => `<tr data-tank="${x.tk.id}" class="${state.sel === x.tk.id ? 'on' : ''}"><td><b>${x.tk.name}</b></td><td>${phaseChip(x)}</td>${x.st.stocked ? `<td class="r">${Math.floor(x.st.doc)}</td><td class="r">${num(x.st.weight, 1)}</td><td class="r">${num(x.st.count, 0)}</td><td class="r">${num(x.st.biomass, 0)}</td><td class="r${x.st.density > DENSITY_LIMIT ? ' sv2' : ''}">${num(x.st.density, 2)}</td>` : '<td class="r q">—</td>'.repeat(5)}
      ${cell(x, 'do')}${cell(x, 'temp')}${cell(x, 'ph')}${cell(x, 'tan')}<td class="r">${x.st.stocked ? num(x.st.feedToday, 1) : '<span class="q">—</span>'}</td><td>${x.st.stocked ? fmtDate(x.st.harvestAt) : '<span class="q">—</span>'}</td><td>${x.st.stocked ? spark(D.series(x.tk.id, 'do', snap.t - 7 * DAY, snap.t), '#3fa8cd') : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <aside class="card tside" id="tank-side">${inspectorHtml()}</aside></div>`;
} };
V.entry = { title: 'Update data', render(root, ctx, full) { if (full === 'nav' || !root.dataset.bound || ctx.reset) renderEntry(root, { session: state.session, canEnter: A.can.enter(state.session.role), reset: ctx.reset, slot: ctx.slot, onSaved: () => { tick('keep'); } }); } };
V.history = { title: 'Round history', render(root) { renderHistory(root, { session: state.session, canEnter: A.can.enter(state.session.role) }); } };

// ---- shell -------------------------------------------------------------------------------
function header() {
  const fr = snap.fresh, t = snap.t, live = state.t == null, r = D.roundAt(t), src = fr.sample || (D.getDb().sample !== false && fr.live && t < D.getDb().liveFrom) ? 'sample' : r ? 'entered' : 'none';
  $('#asof').innerHTML = `<small>${live ? 'Showing the latest round' : 'Showing an earlier round'}</small><b>${slotName(D.slotOf(src === 'entered' ? r.t : t))}</b>`;
  $('#asof-src').innerHTML = src === 'entered' ? `Entered by ${esc(r.by || 'Aqua Development')} at ${fmtTime(r.at || r.t)}` : src === 'sample' ? 'Sample history, not farm data' : 'No data entered';
  $('#rn-next').disabled = live; $('#rn-live').hidden = live;
  const st = $('#fresh'); let cls = 'ok', txt = 'Up to date';
  if (fr.sample) { cls = 'sample'; txt = 'Sample data'; } else if (fr.empty) { cls = 'due'; txt = 'No data yet'; } else if (fr.overdue) { const m = Math.round((Date.now() - fr.slot) / 60000); cls = 'late'; txt = `Round overdue by ${m >= 120 ? Math.floor(m / 60) + ' h' : m + ' min'}`; } else if (!fr.submitted) { cls = 'due'; txt = `Round ${fmtTime(fr.slot)} due`; }
  st.className = 'fresh ' + cls; st.querySelector('b').textContent = txt; st.querySelector('small').textContent = fr.submitted || fr.sample ? `Next round ${fmtTime(fr.due)}` : fr.live ? `Missing in 24 h: ${fr.missed}` : '';
  const ab = $('#alarm-btn'), crit = snap.alarms.some(a => a.sev >= 3); ab.querySelector('b').textContent = snap.alarms.length; ab.className = 'alarm-btn' + (crit ? ' crit' : snap.alarms.length ? ' warn' : '');
}
const ctxFor = extra => ({ snap, state, session: state.session, twin, rerender: () => tick(true), ...extra });
function tick(mode, extra) {
  if (!state.session) return; const now = Date.now(); snap = snapshot(viewT()); header();
  const ae = document.activeElement, typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.closest('.page');
  const full = mode === true || mode === 'nav' || mode === 'keep' || (!state.hoverChart && !typing && now - lastFull > 60000); if (full) lastFull = now;
  const v = V[state.view], root = $('#v-' + state.view); if (!v || !root) return;
  if (state.view === 'twin') v.render(root, ctxFor(extra), full);
  else if (state.view === 'entry') { if (mode === 'nav' || (extra && extra.reset)) v.render(root, ctxFor(extra), 'nav'); }
  else if (full) v.render(root, ctxFor(extra), full);
}
function go(view, extra) {
  if (!V[view] || !NAV[state.session.role].some(n => n[0] === view)) view = A.ROLES[state.session.role].home;
  state.view = view; $$('.view').forEach(v => v.hidden = v.id !== 'v-' + view); $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  $('#view-title').textContent = V[view].title; if (twin) twin.running = view === 'twin'; tick('nav', extra); if (view === 'twin' && twin) twin.resize();
  $('.content').scrollTop = 0;
}
function select(id, { fly = false } = {}) { state.sel = id; if (twin) { twin.select(id); if (fly && id) twin.focus(id); } tick(true); }
function stepRound(dir) { const cur = D.slotOf(viewT()), nx = cur + dir * D.SLOT; state.t = nx >= D.slotOf(Date.now()) ? null : nx; tick(true); }

async function startApp() {
  const s = state.session, role = A.ROLES[s.role]; document.body.dataset.role = s.role;
  $('#login').hidden = true; $('#app').hidden = false; $('#user-name').textContent = s.name; $('#user-org').textContent = role.label;
  $('#nav').innerHTML = NAV[s.role].map(([k, l]) => `<button data-view="${k}">${l}</button>`).join('');
  D.load(); snap = snapshot(viewT());
  if (!twin && !startApp.tried) { startApp.tried = true; try { const { Twin } = await import('./twin.js');
      twin = new Twin($('#twin-host'), { onPick: id => select(id), onHover: (id, x, y) => { if (!id || !snap) return showTip(null); const q = snap.tanks.get(id), v = tankVisual(q, state.colorBy); showTip(`<b>${q.tk.name}</b> — ${esc(q.st.label)}<br>${q.st.stocked ? `${num(q.st.weight, 1)} g, ${num(q.st.biomass, 0)} kg, DO ${q.r.do == null ? 'not measured' : num(q.r.do, 2) + ' mg/L'}` : esc(v.text)}`, x, y); } });
      for (const k in state.layers) twin.setLayer(k, state.layers[k]); window.__twin = twin; } catch (err) { console.warn('3D view unavailable:', err); twin = null; } }
  go(role.home);
}

function bind() {
  initHover(h => { state.hoverChart = h; });
  // sign-in and first-run setup
  const form = $('#login-form'), setupF = $('#setup-form'), err = $('#login-err'), mode = () => { const first = A.needsSetup(); setupF.hidden = !first; form.hidden = first; $('#login-lead').textContent = first ? 'First use on this computer: create the super admin account. The super admin then creates every other user.' : 'Sign in with the username and password the super admin gave you.'; err.hidden = true; };
  const enter = r => { if (r.error) { err.textContent = r.error; err.hidden = false; return; } err.hidden = true; form.reset(); setupF.reset(); state.session = r.session; startApp(); };
  form.addEventListener('submit', async e => { e.preventDefault(); enter(await A.signIn(form.username.value, form.password.value)); });
  setupF.addEventListener('submit', async e => { e.preventDefault(); enter(await A.setup({ name: setupF.fullname.value, username: setupF.username.value, password: setupF.password.value, again: setupF.again.value })); });
  $('#setup-file').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { const o = JSON.parse(t); if (!A.importUsers(o.users)) throw new Error('nousers'); D.replaceDb(o); mode(); toast('Accounts and data loaded. Sign in with your username and password.', 'ok'); }).catch(() => { err.textContent = 'That file does not hold AquaDev accounts. Use a data file downloaded by a super admin.'; err.hidden = false; }); });
  mode();
  $('#signout').addEventListener('click', () => { A.signOut(); state.session = null; state.sel = null; state.t = null; $('#app').hidden = true; $('#login').hidden = false; mode(); });
  // shell
  $('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view); });
  $('#rn-prev').addEventListener('click', () => stepRound(-1)); $('#rn-next').addEventListener('click', () => stepRound(1)); $('#rn-live').addEventListener('click', () => { state.t = null; tick(true); });
  $('#alarm-btn').addEventListener('click', () => go('alarms'));
  $('#color-by').innerHTML = Object.entries(MODES).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join('');
  $('#color-by').addEventListener('change', e => { state.colorBy = e.target.value; tick(true); });
  $('#layers').innerHTML = Object.entries({ labels: 'Labels', piping: 'Pipework', sensors: 'Sensor points', structure: 'Steel structure', grid: 'Structural grid', campus: 'Campus around the farm' }).map(([k, l]) => `<label><input type="checkbox" data-layer="${k}" ${state.layers[k] ? 'checked' : ''}>${l}</label>`).join('');
  $('#layers').addEventListener('change', e => { const k = e.target.dataset.layer; state.layers[k] = e.target.checked; twin && twin.setLayer(k, e.target.checked); });
  $('#views').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !twin) return; twin.setView(b.dataset.cam); $$('#views button').forEach(x => x.classList.toggle('on', x === b)); $$('#roof button').forEach(x => x.classList.toggle('on', x.dataset.roof === twin.roofMode)); });
  $('#roof').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !twin) return; twin.setRoof(b.dataset.roof); $$('#roof button').forEach(x => x.classList.toggle('on', x === b)); });
  document.addEventListener('change', e => { const v = V[state.view]; if (state.session && v && v.change && e.target.closest('.view')) v.change(e.target, ctxFor()); });
  document.addEventListener('click', e => {
    if (!state.session) return;
    const act = e.target.closest('[data-act]'), ack = e.target.closest('[data-ack]'), srt = e.target.closest('th[data-sort]'), par = e.target.closest('tr[data-param]'), tk = e.target.closest('[data-tank]'), to = e.target.closest('[data-go]'), os = e.target.closest('[data-open-slot]');
    if (ack) { state.acks.add(ack.dataset.ack); return tick(true); }
    if (srt) { state.sort = srt.dataset.sort; return tick(true); }
    if (par) { state.param = par.dataset.param; return tick(true); }
    if (os) { openSlot(+os.dataset.openSlot); return go('entry', { reset: false }); }
    if (to) return go(to.dataset.go);
    if (act) { const a = act.dataset.act;
      if (a === 'close') select(null); else if (a === 'focus') { go('twin'); twin && twin.focus(state.sel); }
      else { const v = V[state.view]; v && v.act && v.act(a, ctxFor(), act); }
      return; }
    if (tk && !e.target.closest('#twin-host')) { const id = +tk.dataset.tank; if (state.view === 'twin' || state.view === 'tanks') select(id, { fly: state.view === 'twin' }); else { state.sel = id; twin && twin.select(id); go('tanks'); } }
  });
  setInterval(() => tick(false), 5000);
  state.session = A.session(); if (state.session) startApp();
}
bind();
