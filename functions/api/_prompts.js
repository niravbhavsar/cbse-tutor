// AI prompt templates (PROJECT.md Section 11). Tune wording here only.

const MAX_TEXT = 12000;   // keeps each call well inside the free Neuron budget

function clip(text) {
  const t = String(text || '');
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n[...]` : t;
}

export const SYSTEM_JSON = 'You are a careful CBSE primary-school teacher. Follow the output format exactly.';

export function quizPrompt({ grade, chapterTitle, chapterText }) {
  return `You are a CBSE curriculum expert for Grade ${grade}.
Chapter: "${chapterTitle}"
Chapter text: """${clip(chapterText)}"""

Generate a quiz in STRICT JSON format only. No prose, no markdown fences.
{
  "mcq": [{"question": "...", "options": ["A","B","C","D"], "answer": "A", "explanation": "..."}],
  "fill_blank": [{"question": "... ___ ...", "answer": "...", "explanation": "..."}],
  "true_false": [{"statement": "...", "answer": true, "explanation": "..."}],
  "short": [{"question": "...", "answer": "...", "explanation": "..."}],
  "long": [{"question": "...", "answer": "...", "explanation": "..."}]
}
Rules:
- Counts: 5 mcq, 3 fill_blank, 2 true_false, 2 short, 1 long.
- Language: age-appropriate for Grade ${grade}.
- Stick strictly to the chapter text — do not invent facts.`;
}

export function visualPrompt({ grade, chapterTitle, chapterText }) {
  return `Generate a Mermaid.js mind map for this chapter.
Return ONLY valid Mermaid syntax (start with "mindmap").
Max 15 nodes. Use short labels suitable for a Grade ${grade} child.
Chapter: "${chapterTitle}"
Content: """${clip(chapterText)}"""`;
}

export function practicalPrompt({ grade, chapterTitle, chapterText }) {
  return `Suggest ONE hands-on "Try this at home" activity for a Grade ${grade} child
based on this chapter. Use materials found at home.
Return JSON: {"title": "...", "materials": [...], "steps": [...], "learning": "..."}
Chapter: "${chapterTitle}"
Content: """${clip(chapterText)}"""`;
}

export function funPrompt({ grade, chapterTitle, chapterText }) {
  return `Create 6 matching pairs (label ↔ definition/part) for a drag-and-drop game.
Return JSON: [{"left": "...", "right": "..."}, ...]
Age-appropriate for Grade ${grade}.
Chapter: "${chapterTitle}"
Content: """${clip(chapterText)}"""`;
}
