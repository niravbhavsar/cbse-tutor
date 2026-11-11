// GET /api/learning/:chapterId — cached Visual / Practical / Fun content (any role)
import { json } from '../_lib.js';
import { loadQuizRow } from '../_store.js';

export async function onRequestGet({ env, params }) {
  const row = await loadQuizRow(env, params.chapterId);
  return json({ ok: true, learning: (row && row.learning) || {} });
}
