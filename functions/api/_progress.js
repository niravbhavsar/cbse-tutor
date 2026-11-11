// Wrong-answer log (progress.wrong_json) shared by test submit and revision.
// Each entry: { qid, q (question text snapshot), wrong_at, count }.
// The snapshot lets us drop entries whose question was later regenerated.
import { parseJson, nowIso, newId } from './_lib.js';
import { getItem, itemText } from './_quiz.js';

export function mergeWrong(existing, graded) {
  const map = new Map((existing || []).map(w => [w.qid, w]));
  const ts = nowIso();
  for (const g of graded) {
    if (g.correct === true) map.delete(g.qid);
    else if (g.correct === false) {
      const prev = map.get(g.qid);
      map.set(g.qid, { qid: g.qid, q: g.text, wrong_at: ts, count: ((prev && prev.count) || 0) + 1 });
    }
  }
  return [...map.values()];
}

export function liveWrongItems(wrong, quiz) {
  return (wrong || []).filter(w => {
    const found = getItem(quiz, w.qid);
    return found && itemText(found.item) === w.q;
  });
}

export async function loadProgress(env, childId, chapterId) {
  const row = await env.DB.prepare('SELECT * FROM progress WHERE child_id = ? AND chapter_id = ?').bind(childId, chapterId).first();
  return row ? { ...row, wrong: parseJson(row.wrong_json, []) } : null;
}

export function saveProgressStmts(env, { childId, chapterId, score, wrong, kind, total, answers }) {
  const ts = nowIso();
  const stmts = [];
  if (score === undefined) {
    // Revision only updates the wrong list, never the chapter test score.
    stmts.push(env.DB.prepare(
      `INSERT INTO progress (child_id, chapter_id, score, wrong_json, updated_at) VALUES (?, ?, NULL, ?, ?)
       ON CONFLICT(child_id, chapter_id) DO UPDATE SET wrong_json = excluded.wrong_json, updated_at = excluded.updated_at`
    ).bind(childId, chapterId, JSON.stringify(wrong), ts));
  } else {
    stmts.push(env.DB.prepare(
      `INSERT INTO progress (child_id, chapter_id, score, wrong_json, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(child_id, chapter_id) DO UPDATE SET score = excluded.score, wrong_json = excluded.wrong_json, updated_at = excluded.updated_at`
    ).bind(childId, chapterId, score, JSON.stringify(wrong), ts));
  }
  stmts.push(env.DB.prepare(
    'INSERT INTO attempts (id, child_id, chapter_id, kind, score, total, answers_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(newId(), childId, chapterId, kind, score ?? null, total ?? null, JSON.stringify(answers || {}), ts));
  return stmts;
}

export function revisionDays(env) {
  const n = Number(env.REVISION_DAYS);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}
