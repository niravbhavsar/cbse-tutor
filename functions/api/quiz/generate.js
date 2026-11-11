// POST /api/quiz/generate — { chapter_id, regenerate? } (parent)
// Cached in quiz_cache: the AI is called again ONLY when regenerate=true.
// New/regenerated questions are always approved=0 until the parent approves.
import { json, readJson, requireRole, HttpError, str, nowIso } from '../_lib.js';
import { runText, extractJson, isMock } from '../_ai.js';
import { quizPrompt, SYSTEM_JSON } from '../_prompts.js';
import { normalizeQuiz, countQuestions } from '../_quiz.js';
import { loadQuizRow, loadChapterForAi } from '../_store.js';
import { MOCK } from '../_mock.js';

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const body = await readJson(request);
  const chapterId = str(body.chapter_id, { field: 'chapter_id', max: 80 });
  const chapter = await loadChapterForAi(env, chapterId);
  if (!chapter) throw new HttpError(404, 'Chapter not found');

  const existing = await loadQuizRow(env, chapterId);
  if (existing && existing.has_questions && body.regenerate !== true) {
    return json({ ok: true, cached: true, quiz: existing.questions, approved: existing.approved,
      answer_key_visible: existing.answer_key_visible, updated_at: existing.updated_at });
  }
  if (!chapter.content_text || !chapter.content_text.trim()) {
    throw new HttpError(400, 'Save the chapter text first — questions are made only from the chapter');
  }
  if (chapter.content_text.trim().length < 40) {
    throw new HttpError(400, 'The chapter text is too short — add at least a few sentences from the book');
  }

  const raw = isMock(env)
    ? MOCK.quiz
    : extractJson(await runText(env, quizPrompt({ grade: chapter.grade, chapterTitle: chapter.title, chapterText: chapter.content_text }),
        { system: SYSTEM_JSON, maxTokens: 3000 }));
  const quiz = normalizeQuiz(raw);
  if (!countQuestions(quiz)) throw new HttpError(502, 'The AI reply could not be understood. Please try again.');

  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO quiz_cache (chapter_id, questions_json, approved, answer_key_visible, generated_at, updated_at)
     VALUES (?, ?, 0, 0, ?, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET questions_json = excluded.questions_json, approved = 0,
       generated_at = excluded.generated_at, updated_at = excluded.updated_at`
  ).bind(chapterId, JSON.stringify(quiz), ts, ts).run();

  const row = await loadQuizRow(env, chapterId);
  return json({ ok: true, cached: false, quiz: row.questions, approved: false,
    answer_key_visible: row.answer_key_visible, updated_at: row.updated_at });
}
