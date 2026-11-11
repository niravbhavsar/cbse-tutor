// POST /api/learning/generate — { chapter_id, mode: visual|practical|fun, regenerate? } (parent)
// Stored in quiz_cache.learning_json so re-opening a tab never re-calls the AI.
import { json, readJson, requireRole, HttpError, str, nowIso } from '../_lib.js';
import { runText, extractJson, isMock } from '../_ai.js';
import { visualPrompt, practicalPrompt, funPrompt, SYSTEM_JSON } from '../_prompts.js';
import { loadQuizRow, loadChapterForAi } from '../_store.js';
import { MOCK } from '../_mock.js';

const s = (v, max = 500) => String(v ?? '').trim().slice(0, max);

function cleanMermaid(text) {
  let code = String(text || '').replace(/```(?:mermaid)?/gi, '').trim();
  const at = code.search(/^\s*mindmap\b/im);
  if (at > 0) code = code.slice(at);
  if (!/^mindmap\b/i.test(code)) code = `mindmap\n${code}`;
  return code.split('\n').slice(0, 60).join('\n');
}

const MODES = {
  visual: {
    prompt: visualPrompt,
    parse: text => {
      const code = cleanMermaid(text);
      if (code.split('\n').length < 3) throw new HttpError(502, 'The AI mind map was empty. Please try again.');
      return code;
    }
  },
  practical: {
    prompt: practicalPrompt,
    parse: text => {
      const v = typeof text === 'object' ? text : extractJson(text);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(502, 'The AI reply could not be understood. Please try again.');
      const list = x => (Array.isArray(x) ? x : x ? [x] : []).map(i => s(i, 300)).filter(Boolean).slice(0, 15);
      const out = { title: s(v.title, 150), materials: list(v.materials), steps: list(v.steps), learning: s(v.learning, 600) };
      if (!out.title || !out.steps.length) throw new HttpError(502, 'The AI activity was incomplete. Please try again.');
      return out;
    }
  },
  fun: {
    prompt: funPrompt,
    parse: text => {
      let v = typeof text === 'object' ? text : extractJson(text);
      if (v && !Array.isArray(v) && Array.isArray(v.pairs)) v = v.pairs;
      const pairs = (Array.isArray(v) ? v : [])
        .map(p => ({ left: s(p && p.left, 80), right: s(p && p.right, 160) }))
        .filter(p => p.left && p.right).slice(0, 10);
      if (pairs.length < 3) throw new HttpError(502, 'The AI game needs more pairs. Please try again.');
      return pairs;
    }
  }
};

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const body = await readJson(request);
  const chapterId = str(body.chapter_id, { field: 'chapter_id', max: 80 });
  const mode = MODES[body.mode];
  if (!mode) throw new HttpError(400, 'mode must be visual, practical or fun');

  const chapter = await loadChapterForAi(env, chapterId);
  if (!chapter) throw new HttpError(404, 'Chapter not found');
  const row = await loadQuizRow(env, chapterId);
  const learning = (row && row.learning) || {};
  if (learning[body.mode] && body.regenerate !== true) {
    return json({ ok: true, cached: true, learning });
  }
  if (!chapter.content_text || !chapter.content_text.trim()) {
    throw new HttpError(400, 'Save the chapter text first');
  }
  if (chapter.content_text.trim().length < 40) {
    throw new HttpError(400, 'The chapter text is too short — add at least a few sentences from the book');
  }

  const raw = isMock(env)
    ? MOCK[body.mode]
    : await runText(env, mode.prompt({ grade: chapter.grade, chapterTitle: chapter.title, chapterText: chapter.content_text }),
        { system: SYSTEM_JSON, maxTokens: body.mode === 'visual' ? 900 : 1200 });
  learning[body.mode] = mode.parse(raw);
  learning.updated = { ...(learning.updated || {}), [body.mode]: nowIso() };

  // questions_json is NOT NULL, so a learning-only row starts with an empty quiz.
  await env.DB.prepare(
    `INSERT INTO quiz_cache (chapter_id, questions_json, learning_json, approved, answer_key_visible, updated_at)
     VALUES (?, '{}', ?, 0, 0, ?)
     ON CONFLICT(chapter_id) DO UPDATE SET learning_json = excluded.learning_json`
  ).bind(chapterId, JSON.stringify(learning), nowIso()).run();

  return json({ ok: true, cached: false, learning });
}
