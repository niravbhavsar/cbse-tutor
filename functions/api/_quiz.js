// Quiz normalisation, answer stripping and server-side grading.
// Grading happens on the server so the child's browser never needs the key.
import { HttpError } from './_lib.js';

export const TYPES = ['mcq', 'fill_blank', 'true_false', 'short', 'long'];
export const AUTO_GRADED = ['mcq', 'fill_blank', 'true_false'];

const s = (v, max = 1000) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));

function toBool(v) {
  if (typeof v === 'boolean') return v;
  const t = s(v).toLowerCase();
  if (['true', 't', 'yes', 'सही', 'सत्य'].includes(t)) return true;
  if (['false', 'f', 'no', 'गलत', 'असत्य'].includes(t)) return false;
  return null;
}

// AI may answer "B", "B) Paris" or the option text — store the option text.
function resolveMcqAnswer(answer, options) {
  const a = s(answer);
  if (!a) return '';
  const exact = options.find(o => o.toLowerCase() === a.toLowerCase());
  if (exact) return exact;
  const letter = a.match(/^\(?([A-Fa-f])\)?(?:[).:\s-]|$)/);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (options[idx]) return options[idx];
  }
  const loose = options.find(o => a.toLowerCase().includes(o.toLowerCase()) || o.toLowerCase().includes(a.toLowerCase()));
  return loose || '';
}

export function normalizeQuiz(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const list = k => (Array.isArray(q[k]) ? q[k] : []).slice(0, 30).filter(x => x && typeof x === 'object');
  return {
    mcq: list('mcq').map(x => {
      const options = (Array.isArray(x.options) ? x.options : []).map(o => s(o, 300).replace(/^\(?[A-Fa-f][).:]\s+/, '')).filter(Boolean).slice(0, 6);
      return { question: s(x.question), options, answer: resolveMcqAnswer(x.answer, options), explanation: s(x.explanation) };
    }).filter(x => x.question && x.options.length >= 2),
    fill_blank: list('fill_blank').map(x => ({ question: s(x.question), answer: s(x.answer, 300), explanation: s(x.explanation) })).filter(x => x.question),
    true_false: list('true_false').map(x => ({ statement: s(x.statement || x.question), answer: toBool(x.answer), explanation: s(x.explanation) })).filter(x => x.statement),
    short: list('short').map(x => ({ question: s(x.question), answer: s(x.answer, 2000), explanation: s(x.explanation) })).filter(x => x.question),
    long: list('long').map(x => ({ question: s(x.question), answer: s(x.answer, 4000), explanation: s(x.explanation) })).filter(x => x.question)
  };
}

export function countQuestions(quiz) {
  return TYPES.reduce((n, t) => n + ((quiz && quiz[t]) || []).length, 0);
}

// Before the child can see it, every auto-graded item must have a valid key.
export function validateForApproval(quiz) {
  if (!countQuestions(quiz)) throw new HttpError(400, 'Add at least one question before approving');
  quiz.mcq.forEach((x, i) => {
    if (!x.options.includes(x.answer)) throw new HttpError(400, `MCQ ${i + 1}: choose the correct option`);
  });
  quiz.fill_blank.forEach((x, i) => { if (!x.answer) throw new HttpError(400, `Fill-in-the-blank ${i + 1}: add the answer`); });
  quiz.true_false.forEach((x, i) => { if (typeof x.answer !== 'boolean') throw new HttpError(400, `True/False ${i + 1}: choose True or False`); });
}

export function stripAnswers(quiz) {
  const out = {};
  for (const t of TYPES) out[t] = (quiz[t] || []).map(({ answer, explanation, ...rest }) => rest);
  return out;
}

export function getItem(quiz, qid) {
  const [type, idx] = String(qid).split(/-(?=\d+$)/);
  if (!TYPES.includes(type)) return null;
  const item = (quiz[type] || [])[Number(idx)];
  return item ? { type, item } : null;
}

export function itemText(item) {
  return item.question || item.statement || '';
}

function norm(t) {
  return String(t || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
}

function dice(a, b) {
  a = a.replace(/\s+/g, ''); b = b.replace(/\s+/g, '');
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const m = new Map();
  for (let i = 0; i < a.length - 1; i++) { const g = a.substr(i, 2); m.set(g, (m.get(g) || 0) + 1); }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) { const g = b.substr(i, 2); const n = m.get(g) || 0; if (n) { m.set(g, n - 1); hit++; } }
  return (2 * hit) / (a.length + b.length - 2);
}

// Returns true/false for auto-graded items, null for written answers.
export function gradeItem(type, item, value) {
  if (type === 'mcq') return String(value || '') === item.answer;
  if (type === 'true_false') {
    const v = value === true || value === 'true' ? true : value === false || value === 'false' ? false : null;
    return v !== null && v === item.answer;
  }
  if (type === 'fill_blank') {
    const given = norm(value);
    if (!given) return false;
    // "a / b" in the key means either answer is fine.
    return String(item.answer).split('/').map(norm).filter(Boolean)
      .some(ans => ans === given || (ans.length > 3 && dice(ans, given) >= 0.85));
  }
  return null;
}
