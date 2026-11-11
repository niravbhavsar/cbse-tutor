// POST /api/login — verifies PBKDF2 hash, issues an HttpOnly session cookie.
// Each login creates its own session row, so devices are independent.
import { json, readJson, normalizeEmail, str, verifyPassword, createSession, HttpError, nowIso } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = str(body.password, { field: 'Password', max: 200 });

  const user = await env.DB.prepare('SELECT id, email, role, parent_id, pass_hash FROM users WHERE email = ?')
    .bind(email).first();
  const ok = user && await verifyPassword(password, user.pass_hash);
  if (!ok) throw new HttpError(401, 'Wrong email or password');

  // Opportunistic cleanup keeps the sessions table small.
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(nowIso()).run();

  const cookie = await createSession(env, user.id);
  const { pass_hash, ...safe } = user;
  return json({ ok: true, user: safe }, 200, { 'Set-Cookie': cookie });
}
