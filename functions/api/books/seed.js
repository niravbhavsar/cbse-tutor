// POST /api/books/seed — copies books.json into D1 (parent).
// Idempotent: fingerprint dedupe means re-running never duplicates.
// After this, D1 (not the static file) is the source of truth for chapters.
import { json, requireRole, HttpError } from '../_lib.js';
import { validateBookInput, saveBook } from '../_books.js';

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const res = await env.ASSETS.fetch(new URL('/books.json', request.url));
  if (!res.ok) throw new HttpError(500, 'Seed file books.json is missing');
  const seed = await res.json();

  let created = 0, existing = 0;
  for (const raw of seed) {
    const input = validateBookInput(raw);
    const result = await saveBook(env, input, { id: raw.id, source: 'seed' });
    result.created ? created++ : existing++;
  }
  return json({ ok: true, created, existing });
}
