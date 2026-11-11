// GET /api/books/:id — book + chapter list (any role)
// PUT /api/books/:id — fix title/subject/publisher (parent)
import { json, readJson, requireRole, HttpError, str, int, bookFingerprint } from '../_lib.js';
import { getBookWithChapters } from '../_books.js';

export async function onRequestGet({ env, params }) {
  const book = await getBookWithChapters(env, 'id', params.id);
  if (!book) throw new HttpError(404, 'Book not found');
  return json({ ok: true, book });
}

export async function onRequestPut({ request, env, params, data }) {
  requireRole(data, 'parent');
  const current = await env.DB.prepare('SELECT * FROM books WHERE id = ?').bind(params.id).first();
  if (!current) throw new HttpError(404, 'Book not found');
  const body = await readJson(request);
  const next = {
    grade: body.grade !== undefined ? int(body.grade, { field: 'Grade', min: 1, max: 12 }) : current.grade,
    subject: body.subject !== undefined ? str(body.subject, { field: 'Subject', max: 60 }) : current.subject,
    title: body.title !== undefined ? str(body.title, { field: 'Title', max: 200 }) : current.title,
    publisher: body.publisher !== undefined ? str(body.publisher, { field: 'Publisher', max: 100, required: false }) : current.publisher
  };
  const fp = await bookFingerprint(next.grade, next.subject, next.title);
  const clash = await env.DB.prepare('SELECT id FROM books WHERE fingerprint = ? AND id <> ?').bind(fp, params.id).first();
  if (clash) throw new HttpError(409, 'Another book with this title already exists');
  await env.DB.prepare('UPDATE books SET grade = ?, subject = ?, title = ?, publisher = ?, fingerprint = ? WHERE id = ?')
    .bind(next.grade, next.subject, next.title, next.publisher, fp, params.id).run();
  return json({ ok: true, book: await getBookWithChapters(env, 'id', params.id) });
}
