// POST /api/signup
// Bootstrap rule: while the users table is empty, anyone may create the first
// PARENT account. After that, only a logged-in parent can create accounts,
// and every account they create is a CHILD linked to them. This keeps a
// public *.pages.dev URL from accepting strangers.
import { json, readJson, normalizeEmail, str, hashPassword, newId, nowIso, HttpError, createSession } from './_lib.js';

export async function onRequestPost({ request, env, data }) {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = str(body.password, { field: 'Password', min: 8, max: 200 });

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first('n');
  let role, parentId = null;
  if (count === 0) {
    role = 'parent';
  } else {
    if (!data.user) throw new HttpError(403, 'Sign-up is closed. Ask the parent to create your account.');
    if (data.user.role !== 'parent') throw new HttpError(403, 'Only a parent can add accounts');
    role = 'child';
    parentId = data.user.id;
  }

  const exists = await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) throw new HttpError(409, 'That email is already registered');

  const user = { id: newId(), email, role, parent_id: parentId, created_at: nowIso() };
  await env.DB.prepare('INSERT INTO users (id, email, pass_hash, role, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(user.id, email, await hashPassword(password), role, parentId, user.created_at).run();

  // The first parent is logged straight in; a parent adding a child stays as themself.
  const headers = {};
  if (role === 'parent') headers['Set-Cookie'] = await createSession(env, user.id);
  return json({ ok: true, user }, 201, headers);
}
