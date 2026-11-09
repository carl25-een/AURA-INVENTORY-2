// lib/auth.js — users, password hashing, sessions, roles, audit log.
//
// Passwords are hashed with scrypt (Node built-in crypto) and a per-user
// salt. Sessions are random tokens stored in the store with an expiry,
// carried in an HttpOnly cookie.

const crypto = require('crypto');
const store = require('./store');

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const ROLES = ['admin', 'manager', 'staff'];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return 'scrypt:' + salt + ':' + hash;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), parts[1], 64);
    return crypto.timingSafeEqual(expected, actual);
  } catch (e) {
    return false;
  }
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, createdAt: u.createdAt };
}

function findByEmail(state, email) {
  const e = String(email || '').trim().toLowerCase();
  return state.users.find((u) => u.email.toLowerCase() === e) || null;
}

function createSession(state, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  state.sessions.push({ token, userId, expiresAt });
  return { token, expiresAt };
}

function sessionUser(state, token) {
  if (!token) return null;
  const s = state.sessions.find((x) => x.token === token);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) return null;
  const u = state.users.find((x) => x.id === s.userId);
  if (!u || !u.active) return null;
  return u;
}

function destroySession(state, token) {
  state.sessions = state.sessions.filter((x) => x.token !== token);
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentUser(state, req) {
  const cookies = parseCookies(req);
  return sessionUser(state, cookies.aura_session);
}

function audit(state, user, action, entity, entityId, detail) {
  state.audit.push({
    id: store.uid('a_'),
    date: new Date().toISOString(),
    userId: user ? user.id : 'system',
    userName: user ? user.name : 'system',
    action, entity, entityId: entityId || null, detail: detail || '',
  });
  if (state.audit.length > 2000) state.audit = state.audit.slice(-2000);
}

module.exports = {
  hashPassword, verifyPassword, publicUser, findByEmail,
  createSession, sessionUser, destroySession, currentUser, audit,
  ROLES, SESSION_TTL_MS,
};
