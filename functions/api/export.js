// GET /api/export — full JSON dump for the parent's "Export JSON" button.
import { json, requireRole } from './_lib.js';
import { exportAll } from './_backup.js';

export async function onRequestGet({ env, data }) {
  requireRole(data, 'parent');
  const dump = await exportAll(env);
  const name = `cbse-tutor-export-${dump.exported_at.slice(0, 10)}.json`;
  return json(dump, 200, { 'Content-Disposition': `attachment; filename="${name}"` });
}
