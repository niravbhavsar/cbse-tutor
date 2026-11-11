// Book/chapter persistence shared by /api/books and /api/books/seed.
import { bookFingerprint, newId, nowIso, sha256Hex, str, int, HttpError } from './_lib.js';

const CHAPTER_COLS = 'id, book_id, chapter_no, title, content_hash, source, created_at, updated_at, (content_text IS NOT NULL AND content_text <> \'\') AS has_content';

export async function listChapters(env, bookId) {
  const { results } = await env.DB.prepare(`SELECT ${CHAPTER_COLS} FROM chapters WHERE book_id = ? ORDER BY chapter_no, title`)
    .bind(bookId).all();
  return results.map(c => ({ ...c, has_content: !!c.has_content }));
}

export async function getBookWithChapters(env, where, value) {
  const book = await env.DB.prepare(`SELECT * FROM books WHERE ${where} = ?`).bind(value).first();
  if (!book) return null;
  return { ...book, chapters: await listChapters(env, book.id) };
}

export function validateBookInput(body) {
  const book = {
    grade: int(body.grade, { field: 'Grade', min: 1, max: 12 }),
    subject: str(body.subject, { field: 'Subject', max: 60 }),
    title: str(body.title, { field: 'Title', max: 200 }),
    publisher: str(body.publisher, { field: 'Publisher', max: 100, required: false })
  };
  const chapters = Array.isArray(body.chapters) ? body.chapters : [];
  if (chapters.length > 100) throw new HttpError(400, 'Too many chapters');
  book.chapters = chapters.map((c, i) => ({
    id: typeof c.id === 'string' && /^[\w-]{1,80}$/.test(c.id) ? c.id : null,
    chapter_no: int(c.chapter_no ?? i + 1, { field: 'Chapter number', min: 0, max: 999 }),
    title: str(c.title, { field: 'Chapter title', max: 200 }),
    content_text: str(c.content_text, { field: 'Chapter text', max: 200000, required: false })
  }));
  return book;
}

// Fingerprint dedupe: an existing book is returned instead of duplicated,
// which is what makes "capture once" hold across devices.
export async function saveBook(env, input, { id, source }) {
  const fingerprint = await bookFingerprint(input.grade, input.subject, input.title);
  const existing = await getBookWithChapters(env, 'fingerprint', fingerprint);
  if (existing) return { book: existing, created: false };

  const bookId = id || newId();
  const ts = nowIso();
  const stmts = [
    env.DB.prepare('INSERT INTO books (id, grade, subject, title, publisher, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(bookId, input.grade, input.subject, input.title, input.publisher, fingerprint, ts)
  ];
  for (const c of input.chapters) {
    const hash = c.content_text ? await sha256Hex(c.content_text) : null;
    stmts.push(env.DB.prepare(
      'INSERT OR IGNORE INTO chapters (id, book_id, chapter_no, title, content_text, content_hash, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(c.id || newId(), bookId, c.chapter_no, c.title, c.content_text, hash, source, ts, ts));
  }
  await env.DB.batch(stmts);
  return { book: await getBookWithChapters(env, 'id', bookId), created: true };
}
