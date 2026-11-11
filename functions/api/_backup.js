// Export / import of all durable tables. Shared by /api/export, /api/import,
// /api/backup and the weekly cron Worker in backup-worker/.
// Sessions are deliberately excluded: they are short-lived login tokens.

export const TABLES = {
  users: ['id', 'email', 'pass_hash', 'role', 'parent_id', 'created_at'],
  books: ['id', 'grade', 'subject', 'title', 'publisher', 'fingerprint', 'created_at'],
  chapters: ['id', 'book_id', 'chapter_no', 'title', 'content_text', 'content_hash', 'source', 'created_at', 'updated_at'],
  quiz_cache: ['chapter_id', 'questions_json', 'learning_json', 'approved', 'answer_key_visible', 'generated_at', 'updated_at'],
  progress: ['child_id', 'chapter_id', 'score', 'wrong_json', 'updated_at'],
  attempts: ['id', 'child_id', 'chapter_id', 'kind', 'score', 'total', 'answers_json', 'created_at']
};
const KEYS = {
  users: ['id'], books: ['id'], chapters: ['id'], quiz_cache: ['chapter_id'],
  progress: ['child_id', 'chapter_id'], attempts: ['id']
};
// Parent tables first so foreign keys are satisfied on import.
const ORDER = ['users', 'books', 'chapters', 'quiz_cache', 'progress', 'attempts'];

export async function exportAll(env) {
  const out = { format: 'cbse-tutor-export', version: 1, exported_at: new Date().toISOString(), tables: {} };
  for (const t of ORDER) {
    const { results } = await env.DB.prepare(`SELECT ${TABLES[t].join(', ')} FROM ${t}`).all();
    out.tables[t] = results;
  }
  return out;
}

// Upsert (not INSERT OR REPLACE, which deletes first and trips D1's foreign
// keys). Restoring an export brings back deleted rows and rolls
// edited rows back to the exported version; rows created after the export stay.
export async function importAll(env, dump) {
  if (!dump || dump.format !== 'cbse-tutor-export' || typeof dump.tables !== 'object') {
    throw new Error('Not a cbse-tutor export file');
  }
  const counts = {};
  for (const t of ORDER) {
    const rows = Array.isArray(dump.tables[t]) ? dump.tables[t] : [];
    const cols = TABLES[t];
    const keys = KEYS[t];
    const updates = cols.filter(c => !keys.includes(c)).map(c => `${c} = excluded.${c}`).join(', ');
    const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ` +
      `ON CONFLICT(${keys.join(', ')}) DO UPDATE SET ${updates}`;
    const stmts = [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      stmts.push(env.DB.prepare(sql).bind(...cols.map(c => {
        const v = row[c];
        return v === undefined ? null : (typeof v === 'object' && v !== null ? JSON.stringify(v) : v);
      })));
    }
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    counts[t] = stmts.length;
  }
  return counts;
}

export async function backupToR2(env, reason = 'manual') {
  if (!env.BACKUP) throw new Error('R2 bucket is not configured');
  const dump = await exportAll(env);
  const key = `backups/${dump.exported_at.slice(0, 10)}/${dump.exported_at.replace(/[:.]/g, '-')}-${reason}.json`;
  await env.BACKUP.put(key, JSON.stringify(dump), { httpMetadata: { contentType: 'application/json' } });
  const counts = Object.fromEntries(Object.entries(dump.tables).map(([k, v]) => [k, v.length]));
  return { key, counts };
}
