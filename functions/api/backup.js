// POST /api/backup — manual D1 → R2 export (parent). The weekly cron Worker
// in backup-worker/ runs the same code on a schedule.
import { json, requireRole, HttpError } from './_lib.js';
import { backupToR2 } from './_backup.js';

export async function onRequestPost({ env, data }) {
  requireRole(data, 'parent');
  if (!env.BACKUP) {
    throw new HttpError(503, 'R2 is not set up yet — use Export JSON for now (see README)');
  }
  const result = await backupToR2(env, 'manual');
  return json({ ok: true, ...result });
}
