// GET  /api/progress/revision — wrong answers due for another try (child)
// POST /api/progress/revision — { answers: [{ chapter_id, qid, value }] } (child)
// An item comes back REVISION_DAYS (default 3) after it was last answered
// wrongly; answering it correctly removes it from the list.
import { json, readJson, requireRole, parseJson } from '../_lib.js';
import { getItem, gradeItem, stripAnswers } from '../_quiz.js';
import { loadQuizRow } from '../_store.js';
import { liveWrongItems, mergeWrong, saveProgressStmts, revisionDays } from '../_progress.js';

async function childRows(env, childId) {
  const { results } = await env.DB.prepare(
    `SELECT p.chapter_id, p.wrong_json, c.title AS chapter_title, b.subject
       FROM progress p JOIN chapters c ON c.id = p.chapter_id JOIN books b ON b.id = c.book_id
      WHERE p.child_id = ?`
  ).bind(childId).all();
  return results.map(r => ({ ...r, wrong: parseJson(r.wrong_json, []) })).filter(r => r.wrong.length);
}

export async function onRequestGet({ env, data }) {
  const child = requireRole(data, 'child');
  const cutoff = new Date(Date.now() - revisionDays(env) * 864e5).toISOString();
  const items = [];
  let upcoming = 0;
  let nextDue = null;
  for (const r of await childRows(env, child.id)) {
    const quizRow = await loadQuizRow(env, r.chapter_id);
    if (!quizRow || !quizRow.approved) continue;
    const stripped = stripAnswers(quizRow.questions);
    for (const w of liveWrongItems(r.wrong, quizRow.questions)) {
      if (w.wrong_at <= cutoff) {
        const { type, item } = getItem(stripped, w.qid);
        items.push({ chapter_id: r.chapter_id, chapter_title: r.chapter_title, subject: r.subject, qid: w.qid, type, ...item });
      } else {
        upcoming++;
        const due = new Date(new Date(w.wrong_at).getTime() + revisionDays(env) * 864e5).toISOString();
        if (!nextDue || due < nextDue) nextDue = due;
      }
    }
  }
  return json({ ok: true, items: items.slice(0, 15), due: items.length, upcoming, next_due: nextDue, days: revisionDays(env) });
}

export async function onRequestPost({ request, env, data }) {
  const child = requireRole(data, 'child');
  const body = await readJson(request);
  const answers = Array.isArray(body.answers) ? body.answers.slice(0, 50) : [];
  const byChapter = new Map();
  for (const a of answers) {
    if (!a || typeof a.chapter_id !== 'string' || typeof a.qid !== 'string') continue;
    if (!byChapter.has(a.chapter_id)) byChapter.set(a.chapter_id, []);
    byChapter.get(a.chapter_id).push(a);
  }

  const results = [];
  const stmts = [];
  for (const [chapterId, list] of byChapter) {
    const quizRow = await loadQuizRow(env, chapterId);
    if (!quizRow || !quizRow.approved) continue;
    const prog = await env.DB.prepare('SELECT wrong_json FROM progress WHERE child_id = ? AND chapter_id = ?').bind(child.id, chapterId).first();
    const current = liveWrongItems(parseJson(prog && prog.wrong_json, []), quizRow.questions);
    const graded = [];
    for (const a of list) {
      const found = getItem(quizRow.questions, a.qid);
      if (!found || !current.some(w => w.qid === a.qid)) continue;
      const correct = gradeItem(found.type, found.item, a.value);
      graded.push({ qid: a.qid, text: found.item.question || found.item.statement, correct });
      results.push({ chapter_id: chapterId, qid: a.qid, correct,
        ...(quizRow.answer_key_visible ? { answer: found.item.answer, explanation: found.item.explanation } : {}) });
    }
    if (!graded.length) continue;
    const wrong = mergeWrong(current, graded);
    const ok = graded.filter(g => g.correct).length;
    stmts.push(...saveProgressStmts(env, {
      childId: child.id, chapterId, wrong, kind: 'revision', total: graded.length,
      answers: { graded: graded.map(({ qid, correct }) => ({ qid, correct })), correct: ok }
    }));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, results, correct: results.filter(r => r.correct).length, total: results.length });
}
