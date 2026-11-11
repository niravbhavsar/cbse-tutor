// POST /api/quiz/answer-key — { chapter_id, visible } (parent)
// Per-chapter switch: the child sees answers/explanations only when on.
import { json, readJson, requireRole, HttpError, str, nowIso } from '../_lib.js';

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const body = await readJson(request);
  const chapterId = str(body.chapter_id, { field: 'chapter_id', max: 80 });
  if (typeof body.visible !== 'boolean') throw new HttpError(400, 'visible must be true or false');
  const ts = nowIso();
  const res = await env.DB.prepare('UPDATE quiz_cache SET answer_key_visible = ?, updated_at = ? WHERE chapter_id = ?')
    .bind(body.visible ? 1 : 0, ts, chapterId).run();
  if (!res.meta.changes) throw new HttpError(404, 'Generate questions first');
  return json({ ok: true, answer_key_visible: body.visible, updated_at: ts });
}
