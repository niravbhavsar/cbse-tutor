// POST /api/chapters — add a chapter to a book (parent)
import { json, readJson, requireRole, HttpError, str, int, newId, nowIso, sha256Hex } from '../_lib.js';

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const body = await readJson(request);
  const bookId = str(body.book_id, { field: 'Book', max: 80 });
  const book = await env.DB.prepare('SELECT id FROM books WHERE id = ?').bind(bookId).first();
  if (!book) throw new HttpError(404, 'Book not found');

  const content = str(body.content_text, { field: 'Chapter text', max: 200000, required: false });
  const ts = nowIso();
  const chapter = {
    id: newId(),
    book_id: bookId,
    chapter_no: int(body.chapter_no, { field: 'Chapter number', min: 0, max: 999, required: false }),
    title: str(body.title, { field: 'Chapter title', max: 200 }),
    content_text: content,
    content_hash: content ? await sha256Hex(content) : null,
    source: str(body.source, { field: 'Source', max: 30, required: false }) || 'manual',
    created_at: ts,
    updated_at: ts
  };
  await env.DB.prepare(
    'INSERT INTO chapters (id, book_id, chapter_no, title, content_text, content_hash, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(chapter.id, chapter.book_id, chapter.chapter_no, chapter.title, chapter.content_text, chapter.content_hash, chapter.source, ts, ts).run();
  return json({ ok: true, chapter }, 201);
}
