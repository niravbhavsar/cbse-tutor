// quiz_cache row access shared by quiz/*, learning/* and progress/*.
import { parseJson } from './_lib.js';
import { countQuestions } from './_quiz.js';

export async function loadQuizRow(env, chapterId) {
  const row = await env.DB.prepare('SELECT * FROM quiz_cache WHERE chapter_id = ?').bind(chapterId).first();
  if (!row) return null;
  const questions = parseJson(row.questions_json, {});
  return {
    ...row,
    questions,
    has_questions: countQuestions(questions) > 0,
    learning: parseJson(row.learning_json, {}),
    approved: !!row.approved,
    answer_key_visible: !!row.answer_key_visible
  };
}

export async function loadChapterForAi(env, chapterId) {
  return env.DB.prepare(
    'SELECT c.id, c.title, c.content_text, b.grade FROM chapters c JOIN books b ON b.id = c.book_id WHERE c.id = ?'
  ).bind(chapterId).first();
}
