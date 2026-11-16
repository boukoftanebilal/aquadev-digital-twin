// auth.js — sign-in for the two organisations. There is no server behind this build, so the access code of
// each role is created on first sign-in and kept (hashed) in this browser only. Replace signIn() with calls
// to a real identity service when the shared database is connected.
export const ROLES = {
  ad: { key: 'ad', org: 'Aqua Development', short: 'AD', job: 'Enter the farm data every 6 hours', home: 'entry' },
  io: { key: 'io', org: 'Innovation Oasis', short: 'IO', job: 'Monitor the farm and issue reports', home: 'twin' },
};
const KEY = 'aquadev.auth.v1', SES = 'aquadev.session.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
async function digest(role, code) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('aquadev-twin|' + role + '|' + code));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const hasCode = role => !!read()[role];
export async function signIn(role, name, code, confirm) {
  if (!ROLES[role]) return { error: 'Choose your organisation.' };
  if (!name.trim()) return { error: 'Enter your name so your updates and reports carry it.' };
  if (code.length < 6) return { error: 'The access code needs at least 6 characters.' };
  const store = read(), h = await digest(role, code);
  if (!store[role]) { if (confirm !== code) return { error: 'The two access codes do not match.' }; store[role] = h; try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { return { error: 'This browser blocks storage, so the access code cannot be kept.' }; } }
  else if (store[role] !== h) return { error: 'That access code is not right for ' + ROLES[role].org + '.' };
  const s = { role, name: name.trim(), since: Date.now() }; try { sessionStorage.setItem(SES, JSON.stringify(s)); } catch { /* session lasts until reload */ } return { session: s };
}
export function session() { try { const s = JSON.parse(sessionStorage.getItem(SES) || 'null'); return s && ROLES[s.role] ? s : null; } catch { return null; } }
export function signOut() { try { sessionStorage.removeItem(SES); } catch { /* nothing stored */ } }
export function resetCode(role) { const s = read(); delete s[role]; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* nothing stored */ } }
