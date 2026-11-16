// site.js — the Innovation Oasis campus around the shrimp farm, measured off master plan A012 (1:2000).
// Coordinates are metres in the farm frame: x along grid A→V, y along grid 1→7, origin at grid A/1.
// The master plan numbers its zones but carries no legend, so `kind` is read from the drawn shapes
// and the room labels; anything marked assumed should be confirmed with the campus team.

export const BOUNDARY = [[-532, -9], [184, -9], [179, 384], [-76, 458], [-83, 488], [-532, 488]];

// Internal roads as centre lines [x0, y0, x1, y1, width].
export const ROADS = [
  [-473, 58, 109, 58, 7], [-473, 58, -473, 454, 7], [-473, 272, 109, 272, 7], [-202, 58, -202, 272, 7],
  [109, 58, 109, 372, 7], [-354, 272, -354, 448, 7], [-354, 340, 60, 340, 6], [-473, 454, -325, 454, 7],
  [-325, 440, -95, 440, 5], [-325, 472, -95, 472, 5], [-325, 440, -325, 472, 5], [-95, 440, -95, 472, 5], [-208, 472, -208, 492, 8],
  [-60, 340, -60, 440, 6], [-503, 75, -503, 250, 5],
];
export const PARKING = [{ x0: -318, x1: -226, y0: 444, y1: 468 }, { x0: -191, x1: -98, y0: 444, y1: 468 }];

// Trial plots and reserved zones (zone numbers as printed on A012).
export const ZONES = [
  { n: '11', x0: -430, x1: -319, y0: -3, y1: 50 }, { n: '12', x0: -319, x1: -219, y0: -3, y1: 50 }, { n: '13', x0: -198, x1: -99, y0: -3, y1: 50 },
  { n: '14', x0: -99, x1: -5, y0: -3, y1: 50 }, { n: '16', x0: 104, x1: 180, y0: -3, y1: 50 },
  { n: '10.1', x0: -467, x1: -415, y0: 63, y1: 165 }, { n: '10.2', x0: -415, x1: -365, y0: 63, y1: 165 }, { n: '7a.2', x0: -365, x1: -318, y0: 63, y1: 165 },
  { n: '10.3', x0: -467, x1: -415, y0: 165, y1: 265 }, { n: '10.4', x0: -415, x1: -365, y0: 165, y1: 265 }, { n: '7a.1', x0: -365, x1: -318, y0: 165, y1: 265 },
  { n: '7', x0: -318, x1: -206, y0: 63, y1: 265 },
  { n: '17', x0: -197, x1: -152, y0: 63, y1: 165 }, { n: '18', x0: -152, x1: -104, y0: 63, y1: 165 }, { n: '19', x0: -104, x1: -54, y0: 63, y1: 165 },
  { n: '20', x0: -54, x1: -3, y0: 63, y1: 165 }, { n: '21', x0: -3, x1: 46, y0: 63, y1: 165 }, { n: '22', x0: 46, x1: 102, y0: 63, y1: 165 },
  { n: '23', x0: -197, x1: -112, y0: 165, y1: 265 }, { n: '24', x0: -112, x1: -97, y0: 165, y1: 265 }, { n: '25', x0: -97, x1: -54, y0: 165, y1: 265 },
  { n: '26', x0: -54, x1: -3, y0: 165, y1: 265 }, { n: '27', x0: -3, x1: 46, y0: 165, y1: 265 }, { n: '28', x0: 46, x1: 102, y0: 165, y1: 265 },
  { n: '29', x0: -53, x1: -8, y0: 279, y1: 405 }, { n: '30', x0: -8, x1: 46, y0: 279, y1: 392 }, { n: '31', x0: 46, x1: 100, y0: 279, y1: 376 },
  { n: '32', x0: 116, x1: 178, y0: 64, y1: 165 }, { n: '33', x0: 116, x1: 178, y0: 165, y1: 268 }, { n: '34', x0: 116, x1: 176, y0: 276, y1: 368 },
  { n: '6', x0: -467, x1: -360, y0: 279, y1: 447 }, { n: '5a', x0: -346, x1: -211, y0: 279, y1: 333, note: 'Future developments' }, { n: '5', x0: -197, x1: -63, y0: 279, y1: 333 },
];

// Buildings and structures. `rot` is degrees clockwise in plan.
export const BUILDINGS = [
  { id: 'hub', name: 'Innovation Oasis main building', zone: '1', kind: 'office', x: -208, y: 390, w: 57, d: 59, h: 8.5, court: [22, 24] },
  { id: 'gh3a', name: 'Greenhouse', zone: '3', kind: 'greenhouse', x: -329.5, y: 393, w: 18.5, d: 55, h: 5.2, rot: -15, assumed: true },
  { id: 'gh3b', name: 'Greenhouse', zone: '3', kind: 'greenhouse', x: -292, y: 390, w: 18.5, d: 55, h: 5.2, rot: -15, assumed: true, quiet: true },
  { id: 'gh3c', name: 'Greenhouse link', zone: '3', kind: 'greenhouse', x: -310.5, y: 398, w: 24, d: 20, h: 4.2, rot: -15, assumed: true, quiet: true },
  { id: 'gh2a', name: 'Greenhouse', zone: '2', kind: 'greenhouse', x: -124.5, y: 390, w: 18.5, d: 55, h: 5.2, rot: 15, assumed: true },
  { id: 'gh2b', name: 'Greenhouse', zone: '2', kind: 'greenhouse', x: -87, y: 393, w: 18.5, d: 55, h: 5.2, rot: 15, assumed: true, quiet: true },
  { id: 'gh2c', name: 'Greenhouse link', zone: '2', kind: 'greenhouse', x: -105.5, y: 398, w: 24, d: 20, h: 4.2, rot: 15, assumed: true, quiet: true },
  { id: 'staffhub', name: 'Support staff hub', zone: '9.3', kind: 'canopy', x: -208, y: 34, r: 12, h: 6 },
  { id: 'gate', name: 'Security office and gate', zone: '1a', kind: 'small', x: -209, y: 479, w: 7, d: 5, h: 3.2 },
  { id: 'acc1', name: 'Staff accommodation', kind: 'small', x: -512.5, y: 123, w: 15, d: 48, h: 3.6 },
  { id: 'bung1', name: 'Senior bungalows', kind: 'small', x: -512, y: 92, w: 13, d: 12, h: 3.4, quiet: true }, { id: 'bung2', name: 'Senior bungalows', kind: 'small', x: -488, y: 92, w: 13, d: 12, h: 3.4 },
  { id: 'majlis', name: 'Workers compound', kind: 'round', x: -500.5, y: 56, r: 9, h: 4 },
  { id: 'store', name: 'Support facility, open storage', kind: 'yard', x: -511.8, y: 164, w: 13.6, d: 25.7, h: 0.4 },
  { id: 'waste', name: 'Waste management facility', kind: 'shed', x: -495.3, y: 194, w: 37.4, d: 34.3, h: 6 },
  { id: 'tx', name: 'Transformer and RMU rooms', kind: 'small', x: -486, y: 255, w: 10.5, d: 13.5, h: 3.5 },
  { id: 'tank91', name: 'Water tank', zone: '9.1', kind: 'tank', x: -518, y: 272, r: 7, h: 5, assumed: true },
  { id: 'pump', name: 'Central pump station', kind: 'small', x: -507.5, y: 397, w: 19, d: 18, h: 4.5 }, { id: 'pump2', name: 'Pump station reservoir', kind: 'yard', x: -499, y: 414, w: 28, d: 12, h: 1.2, quiet: true },
  { id: 'office', name: 'Security and control office', kind: 'office', x: -507, y: 455, w: 16, d: 24, h: 4 },
  { id: 'ut6', name: 'Utility compound UT-6', kind: 'yard', x: -444, y: 20, w: 20, d: 21, h: 0.4, quiet: true },
];
export const POND = { name: 'Storm drainage pond and wildlife area', x: -496, y: 18, r: 24 };
export const FARM_ZONE = { n: '15', name: 'AquaDev shrimp farm', x0: -0.2, x1: 99.8, y0: 0.25, y1: 49.75 };
