// GET /api/quiz/:chapterId
// Parent: full quiz incl. drafts. Child: approved quizzes only, with answers
// and explanations removed unless answer_key_visible=1.
import { json, HttpError } from '../_lib.js';
import { stripAnswers } from '../_quiz.js';
import { loadQuizRow } from '../_store.js';

export async function onRequestGet({ env, params, data }) {
  const row = await loadQuizRow(env, params.chapterId);
  if (!row || !row.has_questions) throw new HttpError(404, 'No questions yet');
  const meta = { approved: row.approved, answer_key_visible: row.answer_key_visible, generated_at: row.generated_at, updated_at: row.updated_at };

  if (data.user.role === 'parent') return json({ ok: true, quiz: row.questions, ...meta });

  if (!row.approved) throw new HttpError(404, 'Your test is not ready yet');
  const quiz = row.answer_key_visible ? row.questions : stripAnswers(row.questions);
  return json({ ok: true, quiz, answer_key_visible: row.answer_key_visible, generated_at: row.generated_at });
}
