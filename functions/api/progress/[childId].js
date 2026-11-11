// GET /api/progress/:childId — dashboard data (parent of the child, or the child)
import { json, HttpError, parseJson } from '../_lib.js';
import { revisionDays } from '../_progress.js';

export async function onRequestGet({ env, params, data }) {
  const user = data.user;
  const childId = params.childId;
  const allowed = user.role === 'child'
    ? user.id === childId
    : !!(await env.DB.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'child' AND parent_id = ?").bind(childId, user.id).first());
  if (!allowed) throw new HttpError(403, 'You cannot view this progress');

  const { results: rows } = await env.DB.prepare(
    `SELECT p.chapter_id, p.score, p.wrong_json, p.updated_at, c.title, c.chapter_no, b.title AS book_title, b.subject
       FROM progress p JOIN chapters c ON c.id = p.chapter_id JOIN books b ON b.id = c.book_id
      WHERE p.child_id = ? ORDER BY b.subject, c.chapter_no`
  ).bind(childId).all();

  const { results: attemptRows } = await env.DB.prepare(
    `SELECT a.chapter_id, a.kind, a.score, a.total, a.answers_json, a.created_at, c.title, b.subject
       FROM attempts a JOIN chapters c ON c.id = a.chapter_id JOIN books b ON b.id = c.book_id
      WHERE a.child_id = ? ORDER BY a.created_at`
  ).bind(childId).all();

  const { results: totals } = await env.DB.prepare(
    'SELECT b.subject, COUNT(c.id) AS chapters FROM books b JOIN chapters c ON c.book_id = b.id GROUP BY b.subject'
  ).all();

  const cutoff = new Date(Date.now() - revisionDays(env) * 864e5).toISOString();
  let revisionDue = 0;
  const chapters = rows.map(r => {
    const wrong = parseJson(r.wrong_json, []);
    revisionDue += wrong.filter(w => w.wrong_at <= cutoff).length;
    return { chapter_id: r.chapter_id, title: r.title, chapter_no: r.chapter_no, book_title: r.book_title,
      subject: r.subject, score: r.score, wrong_count: wrong.length, updated_at: r.updated_at };
  });

  const subjects = totals.map(t => {
    const done = chapters.filter(c => c.subject === t.subject && c.score !== null);
    const avg = done.length ? Math.round(done.reduce((a, c) => a + c.score, 0) / done.length) : null;
    return { subject: t.subject, chapters: t.chapters, completed: done.length, average: avg };
  });

  const weak = chapters.filter(c => (c.score !== null && c.score < 60) || c.wrong_count >= 3)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0)).slice(0, 5);

  const attempts = attemptRows.map(a => {
    const ans = parseJson(a.answers_json, {});
    return { chapter_id: a.chapter_id, title: a.title, subject: a.subject, kind: a.kind, score: a.score,
      total: a.total, created_at: a.created_at,
      ...(user.role === 'parent' ? { written: (ans.written || []).filter(w => w.answer) } : {}) };
  });

  return json({ ok: true, child_id: childId, chapters, subjects, weak, attempts, revision_due: revisionDue });
}
