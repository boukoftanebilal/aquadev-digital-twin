// auth.js — user accounts. A super admin creates every other account and sets its password.
// Passwords are never stored: each account keeps a random salt and a PBKDF2-SHA-256 hash.
// This build keeps the user directory in the browser (localStorage); it travels with the data file.
// Swap readUsers()/writeUsers() for a shared service to make accounts work on every device.
export const ROLES = {
  superadmin: { label: 'Super admin', org: 'Platform administration', home: 'twin' },
  io: { label: 'Innovation Oasis', org: 'Innovation Oasis', home: 'twin' },
  ad: { label: 'Aqua Development', org: 'Aqua Development', home: 'entry' },
};
export const can = { enter: r => r === 'ad' || r === 'superadmin', alarm: r => r === 'ad' || r === 'superadmin', ack: r => r === 'io' || r === 'superadmin', report: r => r === 'io' || r === 'superadmin', users: r => r === 'superadmin' };
const KEY = 'aquadev.users.v1', SES = 'aquadev.session.v2', ITER = 150000;
const readUsers = () => { try { const u = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(u) ? u : []; } catch { return []; } };
const writeUsers = u => { try { localStorage.setItem(KEY, JSON.stringify(u)); return true; } catch { return false; } };
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''), unhex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
async function derive(password, saltHex, iter = ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(saltHex), iterations: iter, hash: 'SHA-256' }, key, 256));
}
async function secret(password) { const salt = hex(crypto.getRandomValues(new Uint8Array(16))); return { salt, iter: ITER, hash: await derive(password, salt) }; }
const norm = s => String(s || '').trim().toLowerCase();
function checkName(username, users, selfId) {
  const u = norm(username); if (!/^[a-z0-9._-]{3,32}$/.test(u)) return 'A username is 3 to 32 characters: letters, digits, dot, dash or underscore.';
  if (users.some(x => x.username === u && x.id !== selfId)) return `The username “${u}” is already taken.`; return null;
}
const checkPw = (p, again) => p.length < 8 ? 'A password needs at least 8 characters.' : again !== undefined && p !== again ? 'The two passwords do not match.' : null;
const publicView = u => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active !== false, created: u.created, by: u.by, last: u.last || null });
const admins = users => users.filter(u => u.role === 'superadmin' && u.active !== false);

export const needsSetup = () => readUsers().length === 0;
export const listUsers = () => readUsers().map(publicView).sort((a, b) => a.username.localeCompare(b.username));
export function suggestPassword() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(14)); return [...r].map((b, i) => (i && i % 5 === 4 ? '-' : '') + A[b % A.length]).join(''); }

export async function setup({ username, name, password, again }) {
  const users = readUsers(); if (users.length) return { error: 'The platform is already set up. Sign in instead.' };
  const e = checkName(username, users) || (!String(name).trim() && 'Enter your full name.') || checkPw(password, again); if (e) return { error: e };
  users.push({ id: 'u' + Date.now().toString(36), username: norm(username), name: name.trim(), role: 'superadmin', active: true, created: Date.now(), by: 'setup', ...(await secret(password)) });
  if (!writeUsers(users)) return { error: 'This browser blocks storage, so accounts cannot be kept.' }; return signIn(username, password);
}
export async function signIn(username, password) {
  const users = readUsers(), u = users.find(x => x.username === norm(username)), bad = { error: 'The username or password is not right.' };
  if (!u) { await derive(password || 'x', '00'.repeat(16)); return bad; }
  if ((await derive(password, u.salt, u.iter)) !== u.hash) return bad;
  if (u.active === false) return { error: 'This account is disabled. Ask the super admin to enable it.' };
  u.last = Date.now(); writeUsers(users);
  const s = { id: u.id, username: u.username, name: u.name, role: u.role, since: Date.now() }; try { sessionStorage.setItem(SES, JSON.stringify(s)); } catch { /* session lasts until reload */ } return { session: s };
}
export function session() { try { const s = JSON.parse(sessionStorage.getItem(SES) || 'null'); if (!s) return null; const u = readUsers().find(x => x.id === s.id); return u && u.active !== false ? { ...s, name: u.name, role: u.role } : null; } catch { return null; } }
export function signOut() { try { sessionStorage.removeItem(SES); } catch { /* nothing stored */ } }

const guard = actor => can.users(actor && actor.role) ? null : 'Only the super admin can manage accounts.';
export async function createUser(actor, { username, name, role, password, again }) {
  const users = readUsers(), e = guard(actor) || checkName(username, users) || (!String(name).trim() && 'Enter the person’s full name.') || (!ROLES[role] && 'Choose a role.') || checkPw(password, again); if (e) return { error: e };
  users.push({ id: 'u' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), username: norm(username), name: name.trim(), role, active: true, created: Date.now(), by: actor.username, ...(await secret(password)) });
  return writeUsers(users) ? { ok: true } : { error: 'The account could not be saved.' };
}
export async function resetPassword(actor, id, password, again) {
  const users = readUsers(), u = users.find(x => x.id === id), e = guard(actor) || (!u && 'That account no longer exists.') || checkPw(password, again); if (e) return { error: e };
  Object.assign(u, await secret(password)); return writeUsers(users) ? { ok: true } : { error: 'The password could not be saved.' };
}
export function setActive(actor, id, active) {
  const users = readUsers(), u = users.find(x => x.id === id), e = guard(actor) || (!u && 'That account no longer exists.'); if (e) return { error: e };
  if (!active && u.role === 'superadmin' && admins(users).length <= 1) return { error: 'The last super admin cannot be disabled.' }; if (!active && u.id === actor.id) return { error: 'You cannot disable your own account.' };
  u.active = active; return writeUsers(users) ? { ok: true } : { error: 'The change could not be saved.' };
}
export function removeUser(actor, id) {
  const users = readUsers(), u = users.find(x => x.id === id), e = guard(actor) || (!u && 'That account no longer exists.'); if (e) return { error: e };
  if (u.id === actor.id) return { error: 'You cannot delete your own account.' }; if (u.role === 'superadmin' && admins(users).length <= 1) return { error: 'The last super admin cannot be deleted.' };
  return writeUsers(users.filter(x => x.id !== id)) ? { ok: true } : { error: 'The change could not be saved.' };
}
export async function changeOwnPassword(sess, current, password, again) {
  const users = readUsers(), u = users.find(x => x.id === sess.id); if (!u) return { error: 'Your account was not found.' };
  if ((await derive(current, u.salt, u.iter)) !== u.hash) return { error: 'Your current password is not right.' }; const e = checkPw(password, again); if (e) return { error: e };
  Object.assign(u, await secret(password)); return writeUsers(users) ? { ok: true } : { error: 'The password could not be saved.' };
}
// the user directory travels with the data file so accounts can be moved to another computer
export const exportUsers = () => readUsers();
export function importUsers(list) { if (!Array.isArray(list) || !list.every(u => u && u.username && u.hash && u.salt && ROLES[u.role])) return false; return writeUsers(list); }
