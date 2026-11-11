// GET    /api/chapters/:id — full chapter incl. text (any role)
// PUT    /api/chapters/:id — update with optimistic concurrency (parent)
// DELETE /api/chapters/:id — remove chapter and its quiz/progress (parent)
import { json, readJson, requireRole, HttpError, str, int, nowIso, sha256Hex } from '../_lib.js';

async function loadChapter(env, id) {
  return env.DB.prepare(
    `SELECT c.*, b.title AS book_title, b.subject, b.grade
       FROM chapters c JOIN books b ON b.id = c.book_id WHERE c.id = ?`
  ).bind(id).first();
}

export async function onRequestGet({ env, params }) {
  const chapter = await loadChapter(env, params.id);
  if (!chapter) throw new HttpError(404, 'Chapter not found');
  return json({ ok: true, chapter });
}

export async function onRequestPut({ request, env, params, data }) {
  requireRole(data, 'parent');
  const body = await readJson(request);
  const expected = str(body.updated_at, { field: 'updated_at', max: 40 });
  const current = await loadChapter(env, params.id);
  if (!current) throw new HttpError(404, 'Chapter not found');

  const title = body.title !== undefined ? str(body.title, { field: 'Chapter title', max: 200 }) : current.title;
  const chapterNo = body.chapter_no !== undefined ? int(body.chapter_no, { field: 'Chapter number', min: 0, max: 999, required: false }) : current.chapter_no;
  const content = body.content_text !== undefined ? str(body.content_text, { field: 'Chapter text', max: 200000, required: false }) : current.content_text;
  const source = body.source !== undefined ? str(body.source, { field: 'Source', max: 30, required: false }) : current.source;
  const hash = content ? await sha256Hex(content) : null;
  const ts = nowIso();

  // Optimistic concurrency: only succeeds if nobody saved since this client read it.
  const result = await env.DB.prepare(
    `UPDATE chapters SET title = ?, chapter_no = ?, content_text = ?, content_hash = ?, source = ?, updated_at = ?
      WHERE id = ? AND updated_at = ?`
  ).bind(title, chapterNo, content, hash, source, ts, params.id, expected).run();

  if (!result.meta.changes) {
    throw new HttpError(409, 'This chapter was changed on another device. Reload to see the latest version.', {
      current: await loadChapter(env, params.id)
    });
  }
  return json({ ok: true, chapter: await loadChapter(env, params.id) });
}

export async function onRequestDelete({ env, params, data }) {
  requireRole(data, 'parent');
  const current = await loadChapter(env, params.id);
  if (!current) throw new HttpError(404, 'Chapter not found');
  // D1 enforces foreign keys, so children rows go first.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM attempts WHERE chapter_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM progress WHERE chapter_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM quiz_cache WHERE chapter_id = ?').bind(params.id),
    env.DB.prepare('DELETE FROM chapters WHERE id = ?').bind(params.id)
  ]);
  return json({ ok: true, deleted: params.id });
}
