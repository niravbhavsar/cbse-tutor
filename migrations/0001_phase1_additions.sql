-- Run ONCE only if you applied schema.sql before these additions existed:
--   wrangler d1 execute app-db --remote --file=migrations/0001_phase1_additions.sql
-- (A fresh database only needs schema.sql.)
ALTER TABLE quiz_cache ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  child_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'test',
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
