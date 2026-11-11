// GET  /api/books?fp=<hash>  — lookup by fingerprint (any role)
// GET  /api/books            — all books with chapter lists (any role)
// POST /api/books            — save a new book + chapters, deduped by fingerprint (parent)
import { json, readJson, requireRole, HttpError } from '../_lib.js';
import { getBookWithChapters, listChapters, validateBookInput, saveBook } from '../_books.js';

export async function onRequestGet({ request, env }) {
  const fp = new URL(request.url).searchParams.get('fp');
  if (fp) {
    if (!/^[0-9a-f]{64}$/.test(fp)) throw new HttpError(400, 'Invalid fingerprint');
    const book = await getBookWithChapters(env, 'fingerprint', fp);
    if (!book) throw new HttpError(404, 'Book not found');
    return json({ ok: true, book });
  }
  const { results } = await env.DB.prepare('SELECT * FROM books ORDER BY grade, subject, title').all();
  const books = [];
  for (const b of results) books.push({ ...b, chapters: await listChapters(env, b.id) });
  return json({ ok: true, books });
}

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const body = await readJson(request);
  const input = validateBookInput(body);
  const source = ['seed', 'ncert-api', 'oriz-pdf', 'ocr', 'manual'].includes(body.source) ? body.source : 'manual';
  const { book, created } = await saveBook(env, input, { source });
  return json({ ok: true, book, existing: !created }, created ? 201 : 200);
}
