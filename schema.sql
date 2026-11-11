-- CBSE Personal Tutor — D1 schema (PROJECT.md Section 5)
-- Apply locally:     wrangler d1 execute app-db --file=schema.sql
-- Apply production:  wrangler d1 execute app-db --remote --file=schema.sql
-- IF NOT EXISTS keeps re-runs safe so an accidental second execute never drops data.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT CHECK(role IN ('parent','child')) NOT NULL,
  parent_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  grade INTEGER NOT NULL,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  publisher TEXT,
  fingerprint TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_no INTEGER,
  title TEXT NOT NULL,
  content_text TEXT,
  content_hash TEXT,
  source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (book_id) REFERENCES books(id)
);

CREATE TABLE IF NOT EXISTS quiz_cache (
  chapter_id TEXT PRIMARY KEY,
  questions_json TEXT NOT NULL,
  learning_json TEXT,
  approved INTEGER DEFAULT 0,
  answer_key_visible INTEGER DEFAULT 0,
  generated_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT,                 -- added: optimistic concurrency for quiz edits (8.3)
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

CREATE TABLE IF NOT EXISTS progress (
  child_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  score INTEGER,
  wrong_json TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (child_id, chapter_id),
  FOREIGN KEY (child_id) REFERENCES users(id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- Added beyond Section 5: progress keeps only the latest score per chapter,
-- so every test attempt is also logged here to chart "scores over time"
-- and to let the parent read written (short/long) answers.
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'test',   -- 'test' | 'revision'
  score INTEGER,
  total INTEGER,
  answers_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (child_id) REFERENCES users(id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id);
CREATE INDEX IF NOT EXISTS idx_attempts_child ON attempts(child_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
