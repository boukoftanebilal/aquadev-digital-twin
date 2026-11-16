// model.js — static description of the farm, transcribed from the Arecom drawing set
// (A010–A013 site/master plan, A100/A101 plans, A200 elevations, A300 sections, A400 water
// treatment block, rev 01, 01-11-2025) and the AquaDev KPI workbook.
// Plan coordinates are metres: x runs along grid A→V (0…85), y along grid 1→7 (0…50).
// Anything not stated on the drawings is flagged `assumed: true` so it can be corrected.

export const FARM = {
  name: 'AquaDev Abu Dhabi shrimp farm',
  owner: 'Aqua Development Ltd. / AD Ports Group',
  consultant: 'Arecom Architectural Consultants L.L.C.',
  location: { zone: "Al Fou'ah", sector: 'Al Sajaa', plot: '8' },
  plot: { w: 100, d: 49.5, area: 4950 },
  block: { w: 85, d: 50, area: 4304.16 },
  wtBlock: { w: 14, d: 12.15, area: 180.72, x0: 85.4, y0: 0.2 },
  builtUp: 4484.88,
  coverage: 0.906,
  levels: { tankFloor: -0.30, ffl: 0, serviceFfl: 0.30, tankRim: 0.90, eave: 4.56, crown: 6.45, monitorTop: 7.80 },
};

// Structural grid: A–U at 4 m, U–V 5 m; 1–7 from section B-B.
export const GRID_X = (() => {
  const names = 'ABCDEFGHIJKLMNOPQRSTUV'.split('');
  return names.map((n, i) => ({ name: n, x: i < 21 ? i * 4 : 85 }));
})();
export const GRID_Y = [
  { name: '1', y: 0 }, { name: '2', y: 11.35 }, { name: '3', y: 13.65 }, { name: '4', y: 25 },
  { name: '5', y: 36.35 }, { name: '6', y: 38.65 }, { name: '7', y: 50 },
];
export const BAYS = [[0, 12.5], [12.5, 25], [25, 37.5], [37.5, 50]]; // four barrel vaults

// Tank footprints from the A100 dimension strings.
const COLS = [[1.6, 11.8], [12.8, 22.8], [23.2, 33.2], [34.2, 44.2], [44.6, 54.6], [55.6, 65.6], [66.0, 76.0]];
const ROWS = [[0.9, 11.1], [13.6, 23.8], [25.9, 36.1], [38.5, 48.8]];
export const CORRIDORS = [
  { id: 'SC-1', name: 'Service corridor 1 (grid 2–3)', y0: 11.1, y1: 13.6 },
  { id: 'SC-2', name: 'Service corridor 2 (grid 5–6)', y0: 36.1, y1: 38.5 },
];
export const TANK_SPEC = { footprint: 100, cornerRadius: 2.4, wall: 0.25, waterDepth: 1.0, drainDia: 0.15 };

function gridRef(x, y) {
  const gx = GRID_X.reduce((a, g) => (Math.abs(g.x - x) < Math.abs(a.x - x) ? g : a)).name;
  const gy = y < 12.5 ? '1–2' : y < 25 ? '3–4' : y < 37.5 ? '4–5' : '6–7';
  return `${gx} / ${gy}`;
}

// Numbering is not on the drawings; tanks are numbered 1–28 row by row from grid A/1
// to match "Tank 1…Tank 28" in the KPI workbook. Change TANK_ORDER to renumber.
export const TANKS = [];
ROWS.forEach((r, ri) => COLS.forEach((c, ci) => {
  const id = ri * 7 + ci + 1;
  const corridor = ri < 2 ? 0 : 1;
  const side = ri % 2 === 0 ? -1 : 1; // -1: tank lies on the grid-1 side of its corridor
  const cy = (CORRIDORS[corridor].y0 + CORRIDORS[corridor].y1) / 2;
  TANKS.push({
    id, row: ri, col: ci, x0: c[0], x1: c[1], y0: r[0], y1: r[1],
    cx: (c[0] + c[1]) / 2, cy: (r[0] + r[1]) / 2,
    name: `Tank ${String(id).padStart(2, '0')}`, tag: `GO-${String(id).padStart(2, '0')}`,
    grid: gridRef((c[0] + c[1]) / 2, (r[0] + r[1]) / 2),
    corridor, side,
    column: { x: (c[0] + c[1]) / 2 + 3.4, y: cy + side * 0.62 },
    pump: { x: (c[0] + c[1]) / 2 + 2.2, y: cy + side * 0.7 },
  });
}));

// Floor pits drawn hatched in both corridors on A100 and cut in section A-A.
export const SUMPS = [];
CORRIDORS.forEach((c, k) => COLS.forEach((col, i) => SUMPS.push({
  id: `SP-${k + 1}${i + 1}`, x: col[0] + 1.2, y: (c.y0 + c.y1) / 2, w: 2.0, d: 1.5, corridor: k,
})));

// Service strip along grid U–V (room names from A100).
export const ROOMS = [
  { id: 'PR', name: 'Processing room', x0: 81.7, x1: 84.8, y0: 0.2, y1: 12.5, h: 3.2, build: 'Sandwich panel' },
  { id: 'LAB', name: 'Laboratory', note: 'No chemical use', x0: 81.7, x1: 84.8, y0: 17.6, y1: 21.6, h: 3.0, build: 'Sandwich panel' },
  { id: 'WC', name: 'Toilet', x0: 83.2, x1: 84.8, y0: 21.6, y1: 22.9, h: 3.0, build: 'Sandwich panel' },
  { id: 'MR', name: 'Meeting room', x0: 81.7, x1: 84.8, y0: 22.9, y1: 28.0, h: 3.0, build: 'Sandwich panel' },
  { id: 'CPR', name: 'Control panel room', x0: 81.7, x1: 84.8, y0: 28.0, y1: 38.6, h: 3.0, build: 'Sandwich panel' },
  { id: 'CS', name: 'Cold storage', x0: 81.7, x1: 84.8, y0: 42.7, y1: 45.9, h: 3.0, build: 'Sandwich panel' },
];
export const DOORS = [
  { name: 'Entrance 1', x: 85, y0: 14.05, y1: 17.05 },
  { name: 'Entrance 2', x: 85, y0: 39.15, y1: 42.15 },
];

// Water treatment block (A400): two tanks 4.95 × 8.25 m, floor −0.30, wall top +2.20.
export const WT_TANKS = [
  { id: 'WT-1', name: 'Tank 1', x0: 86.6, x1: 91.55, y0: 1.45, y1: 9.7, floor: -0.30, top: 2.20, role: 'Raw / make-up water', assumed: true },
  { id: 'WT-2', name: 'Tank 2', x0: 92.35, x1: 97.3, y0: 1.45, y1: 9.7, floor: -0.30, top: 2.20, role: 'Treated water reservoir', assumed: true },
];
WT_TANKS.forEach(t => { t.area = (t.x1 - t.x0) * (t.y1 - t.y0); t.depth = t.top - t.floor; t.volume = t.area * t.depth; });

export const DRAWINGS = [
  { no: 'A010', title: 'Site layout', scale: '1:2000', note: 'Whole development, 715.36 × 496.75 m; shrimp farm sits on the top boundary' },
  { no: 'A011', title: 'Site layout — roof and areas', scale: '1:250', note: 'Plot 4,950 m², built-up 4,484.88 m², coverage 90.6 %' },
  { no: 'A012', title: 'Master plan', scale: '1:2000', note: 'Farm block in context of plots 1–34' },
  { no: 'A013', title: 'Master plan — farm and water treatment', scale: '1:250', note: '28 tanks, service rooms, water treatment room' },
  { no: 'A100', title: 'Ground floor plan, farm block', scale: '1:250', note: 'Grid A–V × 1–7, tank floors −0.30 m, Ø0.15 centre drains' },
  { no: 'A101', title: 'Roof plan, farm block', scale: '1:250', note: 'Four vaults with ridge monitors and skylights' },
  { no: 'A200', title: 'Elevations, farm block', scale: '1:250', note: 'Sandwich-panel envelope' },
  { no: 'A300', title: 'Sections, farm block', scale: '1:250', note: 'Eave +4.56 m, crown +6.45 m, monitor +7.80 m' },
  { no: 'A400', title: 'Water treatment block details', scale: '1:250', note: 'Two 4.95 × 8.25 m tanks, wall top +2.20 m, uPVC/GRP roof sheet' },
];

// KPI targets, copied from the "KPIs" sheet of AquaDev_KPI_2025_reporting_draft.xlsx.
export const KPI_TARGETS = {
  tanks:        { label: 'Operational GO tanks', unit: '#', first: 28, full: 28, agg: 'max' },
  juveniles:    { label: 'Inserted juveniles', unit: '#', first: 2940000, full: 3780000, agg: 'sum' },
  harvest:      { label: 'Harvest', unit: 'kg', first: 35000, full: 51408, agg: 'sum' },
  price:        { label: 'Sales price', unit: 'USD/kg', first: 10, full: 10, agg: 'avg' },
  revenue:      { label: 'Revenues', unit: 'USD', first: 300000, full: 514080, agg: 'sum' },
  perTank:      { label: 'Harvest per GO tank', unit: 'kg/tank/yr', first: 1836, full: 1836, agg: 'derived' },
  cycles:       { label: 'Completed production cycles', unit: '#', first: 84, full: 84, agg: 'sum' },
  cyclesTank:   { label: 'Cycles per tank', unit: '#/tank/yr', first: 3, full: 3, agg: 'derived' },
  size:         { label: 'Average harvest size', unit: 'g', first: 25, full: 25, agg: 'avg' },
  density:      { label: 'Max tank density', unit: 'kg/m²', first: 7, full: 7, agg: 'max', limit: 'max' },
  growth:       { label: 'Growth rate', unit: 'g/week', first: 1.7, full: 1.7, agg: 'avg' },
  survival:     { label: 'Survival rate', unit: '%', first: 0.7, full: 0.7, agg: 'avg', pct: true },
  feed:         { label: 'Feed consumption', unit: 'kg', first: 59500, full: 87394, agg: 'sum', limit: 'max' },
  elecCool:     { label: 'Electricity, cooling', unit: 'kWh', first: 0, full: 0, agg: 'sum', limit: 'max' },
  elecProd:     { label: 'Electricity, production', unit: 'kWh', first: 900000, full: 900000, agg: 'sum', limit: 'max' },
  elecOther:    { label: 'Electricity, other', unit: 'kWh', first: 100000, full: 100000, agg: 'sum', limit: 'max' },
  waterTemp:    { label: 'Water temperature', unit: '°C', first: 30, full: 30, agg: 'max', limit: 'max' },
  roomTemp:     { label: 'Max room temperature', unit: '°C', first: 35, full: 35, agg: 'max', limit: 'max' },
  roomRh:       { label: 'Max room humidity', unit: '%', first: 1, full: 1, agg: 'max', pct: true, limit: 'max' },
};
export const KEY_FIGURES = { // derived rows of the "Key Figures" block, full-capacity column
  fcr: 87394 / 51408, prodIndex: 51408 / 2800, kwhPerKg: 1000000 / 51408, revPerKg: 10,
};

// Default alarm limits. The workbook refers to a contract water-quality list that was not
// supplied, so these are common Penaeus vannamei grow-out values — replace with the contract set.
export const LIMITS = {
  do:   { label: 'Dissolved oxygen', unit: 'mg/L', dp: 2, lo2: 3.5, lo1: 4.5, t0: 5.0, t1: 7.5, hi1: 9.0, hi2: 10.5, min: 2, max: 10, assumed: true },
  temp: { label: 'Water temperature', unit: '°C', dp: 1, lo2: 26.0, lo1: 28.0, t0: 29.0, t1: 30.5, hi1: 31.5, hi2: 33.0, min: 24, max: 35 },
  ph:   { label: 'pH', unit: '', dp: 2, lo2: 7.0, lo1: 7.4, t0: 7.6, t1: 8.2, hi1: 8.5, hi2: 8.8, min: 6.5, max: 9, assumed: true },
  sal:  { label: 'Salinity', unit: 'ppt', dp: 1, lo2: 15, lo1: 20, t0: 23, t1: 27, hi1: 30, hi2: 35, min: 10, max: 40, assumed: true },
  tan:  { label: 'Total ammonia N', unit: 'mg/L', dp: 2, lo2: -1, lo1: -1, t0: 0, t1: 0.8, hi1: 1.0, hi2: 2.0, min: 0, max: 3, assumed: true },
  no2:  { label: 'Nitrite N', unit: 'mg/L', dp: 2, lo2: -1, lo1: -1, t0: 0, t1: 0.8, hi1: 1.0, hi2: 2.5, min: 0, max: 3, assumed: true },
  alk:  { label: 'Alkalinity', unit: 'mg/L CaCO₃', dp: 0, lo2: 80, lo1: 100, t0: 120, t1: 180, hi1: 220, hi2: 260, min: 60, max: 280, assumed: true },
  level:{ label: 'Water depth', unit: 'm', dp: 2, lo2: 0.75, lo1: 0.90, t0: 0.95, t1: 1.05, hi1: 1.12, hi2: 1.18, min: 0, max: 1.2, assumed: true },
};
export const DENSITY_LIMIT = 7; // kg/m², KPI workbook

export const ASSUMPTIONS = [
  'Tank numbering 1–28 runs row by row from grid A/1; the drawings do not number the tanks.',
  'The yellow vessels beside each tank in the renders are modelled as one treatment column and one circulation pump per tank; their duty is not stated in the documents.',
  'Roles of water treatment Tank 1 and Tank 2 are not stated on A400; shown as raw and treated water.',
  'Water-quality alarm limits are typical P. vannamei values, pending the contract list the KPI workbook refers to.',
  'Stocking is 34,000 juveniles per tank per cycle, the number that yields the 612 kg/cycle target at 70 % survival and 25 g.',
  'No sensor feed is connected yet: every live value is produced by the built-in simulator.',
];
