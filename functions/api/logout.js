// POST /api/logout — deletes ONLY this device's session row.
import { json, clearSessionCookie } from './_lib.js';

export async function onRequestPost({ env, data }) {
  if (data.user) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(data.user.token_hash).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}
