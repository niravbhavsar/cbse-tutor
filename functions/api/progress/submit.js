// POST /api/progress/submit — { chapter_id, answers: { "<qid>": value } } (child)
// Grades on the server against the approved key, saves the latest score,
// merges wrong answers into progress.wrong_json and logs the attempt.
import { json, readJson, requireRole, HttpError, str } from '../_lib.js';
import { TYPES, AUTO_GRADED, gradeItem, itemText } from '../_quiz.js';
import { loadQuizRow } from '../_store.js';
import { loadProgress, mergeWrong, saveProgressStmts } from '../_progress.js';

export async function onRequestPost({ request, env, data }) {
  const child = requireRole(data, 'child');
  const body = await readJson(request);
  const chapterId = str(body.chapter_id, { field: 'chapter_id', max: 80 });
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};

  const row = await loadQuizRow(env, chapterId);
  if (!row || !row.approved || !row.has_questions) throw new HttpError(404, 'This test is not ready yet');
  const quiz = row.questions;

  const graded = [];
  const written = [];
  for (const type of TYPES) {
    (quiz[type] || []).forEach((item, i) => {
      const qid = `${type}-${i}`;
      const raw = answers[qid];
      const value = typeof raw === 'string' ? raw.slice(0, 4000) : raw;
      if (AUTO_GRADED.includes(type)) {
        graded.push({ qid, type, text: itemText(item), value: value ?? null, correct: gradeItem(type, item, value) });
      } else {
        written.push({ qid, type, question: item.question, answer: typeof value === 'string' ? value : '' });
      }
    });
  }

  const correct = graded.filter(g => g.correct).length;
  const total = graded.length;
  const score = total ? Math.round((correct / total) * 100) : null;

  const prev = await loadProgress(env, child.id, chapterId);
  const wrong = mergeWrong(prev && prev.wrong, graded);
  await env.DB.batch(saveProgressStmts(env, {
    childId: child.id, chapterId, score, wrong, kind: 'test', total,
    answers: { graded: graded.map(({ qid, value, correct }) => ({ qid, value, correct })), written }
  }));

  const showKey = row.answer_key_visible;
  const results = graded.map(g => {
    const item = quiz[g.type][Number(g.qid.split('-').pop())];
    return { qid: g.qid, correct: g.correct, ...(showKey ? { answer: item.answer, explanation: item.explanation } : {}) };
  });
  const writtenResults = showKey
    ? written.map(w => ({ qid: w.qid, model_answer: quiz[w.type][Number(w.qid.split('-').pop())].answer }))
    : [];
  return json({ ok: true, score, correct, total, written_count: written.length, results, written: writtenResults, answer_key_visible: showKey });
}
