// POST /api/ocr — tier-3 OCR fallback using Workers AI Vision (parent).
// Body: { image: "<data URL or base64 JPEG/PNG>" }
import { json, readJson, requireRole, HttpError } from './_lib.js';
import { runVision, isMock } from './_ai.js';

const MAX_BYTES = 4 * 1024 * 1024;
const PROMPT = 'Transcribe ALL text in this textbook photo exactly as printed, line by line. ' +
  'Keep chapter numbers and titles on their own lines. Output only the text, no commentary.';

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const body = await readJson(request, 8 * 1024 * 1024);
  const raw = typeof body.image === 'string' ? body.image.replace(/^data:image\/[\w+.-]+;base64,/, '') : '';
  if (!raw) throw new HttpError(400, 'image is required');

  let bytes;
  try {
    bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  } catch {
    throw new HttpError(400, 'image must be base64');
  }
  if (bytes.length > MAX_BYTES) throw new HttpError(413, 'Photo is too large — please retake it');

  if (isMock(env)) {
    return json({ ok: true, text: 'MATHS MELA\nTextbook of Mathematics for Grade 4\nChapter 1: Shapes Around Us\nChapter 2: Hide and Seek', source: 'workers-ai' });
  }
  const text = (await runVision(env, bytes, PROMPT)).trim();
  return json({ ok: true, text, source: 'workers-ai' });
}
