// POST /api/quiz/approve — { chapter_id, questions, approved, updated_at } (parent)
// Saves the parent's edits. approved=true publishes it to the child.
import { json, readJson, requireRole, HttpError, str, nowIso } from '../_lib.js';
import { normalizeQuiz, validateForApproval } from '../_quiz.js';
import { loadQuizRow } from '../_store.js';

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const body = await readJson(request);
  const chapterId = str(body.chapter_id, { field: 'chapter_id', max: 80 });
  const current = await loadQuizRow(env, chapterId);
  if (!current) throw new HttpError(404, 'Generate questions first');

  const quiz = normalizeQuiz(body.questions);
  const approve = body.approved !== false;
  if (approve) validateForApproval(quiz);

  const ts = nowIso();
  // Optimistic concurrency: reject if edited elsewhere since this client loaded it.
  const res = await env.DB.prepare(
    'UPDATE quiz_cache SET questions_json = ?, approved = ?, updated_at = ? WHERE chapter_id = ? AND updated_at IS ?'
  ).bind(JSON.stringify(quiz), approve ? 1 : 0, ts, chapterId, body.updated_at ?? null).run();
  if (!res.meta.changes) {
    throw new HttpError(409, 'These questions were changed on another device. Reload to see the latest.');
  }
  const row = await loadQuizRow(env, chapterId);
  return json({ ok: true, quiz: row.questions, approved: row.approved, answer_key_visible: row.answer_key_visible, updated_at: row.updated_at });
}
