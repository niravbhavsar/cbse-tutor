// GET /api/me — current user (and, for a parent, their children).
import { json } from './_lib.js';

export async function onRequestGet({ env, data }) {
  const { token_hash, ...user } = data.user;
  let children = [];
  if (user.role === 'parent') {
    const { results } = await env.DB.prepare(
      "SELECT id, email, created_at FROM users WHERE role = 'child' AND parent_id = ? ORDER BY created_at"
    ).bind(user.id).all();
    children = results;
  }
  return json({ ok: true, user, children });
}
