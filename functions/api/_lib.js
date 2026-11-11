// Shared helpers for Pages Functions. No npm — Web Crypto + D1 only.
// Files starting with "_" that export no onRequest* handlers create no routes.

export const SESSION_COOKIE = 'sid';
export const SESSION_DAYS = 30;
// Cloudflare Workers caps PBKDF2 at 100k iterations.
const PBKDF2_ITERATIONS = 100000;

// ---------- Responses ----------

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
  });
}

export function error(status, message, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export async function readJson(request, maxBytes = 25 * 1024 * 1024) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'Request is too large');
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

// ---------- Time / ids ----------

// Millisecond-precision ISO timestamps so optimistic-concurrency checks can
// tell apart two edits made within the same second.
export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

// ---------- Validation ----------

export function str(value, { field, min = 0, max = 10000, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') throw new HttpError(400, `${field} must be text`);
  const s = String(value).trim();
  if (s.length < min) throw new HttpError(400, `${field} is too short (min ${min})`);
  if (s.length > max) throw new HttpError(400, `${field} is too long (max ${max})`);
  return s;
}

export function int(value, { field, min = -1e9, max = 1e9, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number`);
  return n;
}

export function normalizeEmail(value) {
  const email = str(value, { field: 'Email', min: 3, max: 254 }).toLowerCase();
  // Loose on purpose: children may use family-style logins like "riya@home".
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email');
  return email;
}

export function normalizeTitle(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// ---------- Crypto ----------

function toB64(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

export function toHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

// Stored format: pbkdf2$<iterations>$<salt b64>$<hash b64>
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const hash = await pbkdf2(password, fromB64(parts[2]), iterations);
  return timingSafeEqual(hash, fromB64(parts[3]));
}

// Book fingerprint: same algorithm runs in app.js so the client can look up
// a book by fingerprint before ever opening the camera.
export async function bookFingerprint(grade, subject, title) {
  return sha256Hex(`${grade}|${normalizeTitle(subject)}|${normalizeTitle(title)}`);
}

// ---------- Sessions ----------

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function sessionCookie(token, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

// Only a SHA-256 of the token is stored, so a leaked DB dump cannot be
// replayed as live sessions.
export async function createSession(env, userId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, expires).run();
  return sessionCookie(token, SESSION_DAYS * 86400);
}

export function clearSessionCookie() {
  return sessionCookie('', 0);
}

export async function getSessionUser(env, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.role, u.parent_id, s.token AS token_hash
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`
  ).bind(await sha256Hex(token), nowIso()).first();
  return row || null;
}

// ---------- Authorization ----------

export function requireRole(data, role) {
  const user = data && data.user;
  if (!user) throw new HttpError(401, 'Please log in');
  if (role && user.role !== role) throw new HttpError(403, `Only a ${role} can do this`);
  return user;
}

// Parent may read their own children; a child may read only themself.
export async function canReadChild(env, user, childId) {
  if (user.role === 'child') return user.id === childId;
  const row = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND role = 'child' AND parent_id = ?")
    .bind(childId, user.id).first();
  return !!row;
}

// ---------- JSON helpers ----------

export function parseJson(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}
