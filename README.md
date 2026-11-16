# AquaDev shrimp farm — digital twin

A browser-based monitoring twin of the AquaDev Abu Dhabi grow-out pilot (plot 8, Al Sajaa, Al Fou'ah):
28 grow-out tanks of 100 m², the service rooms and the water treatment block, modelled from the
Arecom drawing set (A010–A400, rev 01, 01-11-2025) and the AquaDev KPI follow-up workbook.

**Every live value is simulated.** No sensor, PLC or feeding system is connected yet. The simulator is
tuned to the KPI workbook targets and is replaced tank by tank as soon as measured readings are loaded
(see *Data connections* in the app).

## What is in it

| View | Contents |
|---|---|
| Digital twin | 3D model to scale: tanks, treatment columns, pumps, pipework, floor pits, service rooms, water treatment tanks, steel structure and vaulted roof as switchable layers. Tanks can be coloured by alarm status, day of culture, weight, biomass, density, DO, temperature, pH or ammonia. Click a tank for its cycle, stock, feed, water quality and equipment. |
| Tanks | Sortable table of all 28 tanks with the tank panel alongside. |
| Water | Water treatment block levels and flows, water quality of every tank against limits, the alarm limits in force. |
| Production and KPIs | The workbook's KPI rows month by month against first-year and full-capacity targets, key figures, harvest and feed charts, cycle schedule for every tank, CSV export. |
| Energy and climate | Electrical load, monthly kWh, hall temperature and humidity against the 35 °C / 100 % limits. |
| Alarms and log | Active alarms with acknowledgement, 7-day event log. |
| Facility | Plan, areas, levels, rooms, drawing register, and the list of assumptions. |
| Data connections | Paste measured readings, poll a JSON endpoint, change the scenario start date, start a test fault. |

The twin clock can be moved 30 days back or forward and run at up to 6 hours per second.

## Files

- `model.js` — geometry and reference data transcribed from the drawings and the workbook. Start here to correct a dimension, renumber tanks or change alarm limits.
- `sim.js` — deterministic simulator (growth, survival, feed, water quality, incidents, energy, KPIs).
- `twin.js` — the 3D scene (three.js, loaded from jsDelivr).
- `charts.js`, `app.js`, `styles.css`, `index.html` — interface.

No build step. Serve the folder with any static web server, or publish it with GitHub Pages.

## Connecting real data

Readings use the form `tank, parameter, value` with parameters `do, temp, ph, sal, tan, no2, alk, level`.
A polled endpoint returns `{"readings":[{"tank":7,"param":"do","value":4.2}]}` over HTTPS with CORS enabled.

## Assumptions to confirm

1. Tank numbering 1–28 runs row by row from grid A/1; the drawings do not number the tanks.
2. One treatment column and one circulation pump per tank, from the renders; their duty is not documented.
3. Water treatment Tank 1 = raw water, Tank 2 = treated water; A400 does not say.
4. Water-quality limits are typical *P. vannamei* values pending the contract list the workbook refers to.
5. Stocking is 34,000 juveniles per tank per cycle, which gives the 612 kg/cycle target at 70 % survival and 25 g.
   The workbook's 3.78 M juveniles a year (45,000 per cycle) would give about 66 t a year at those rates, not 51.4 t.
