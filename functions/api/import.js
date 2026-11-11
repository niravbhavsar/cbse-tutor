// POST /api/import — restore an export file (parent).
import { json, readJson, requireRole, HttpError } from './_lib.js';
import { importAll } from './_backup.js';

export async function onRequestPost({ request, env, data }) {
  requireRole(data, 'parent');
  const dump = await readJson(request, 90 * 1024 * 1024);
  let counts;
  try {
    counts = await importAll(env, dump);
  } catch (e) {
    throw new HttpError(400, e.message === 'Not a cbse-tutor export file' ? e.message : 'Import failed — the file may be damaged');
  }
  return json({ ok: true, imported: counts });
}
