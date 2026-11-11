// Weekly D1 → R2 backup (PROJECT.md Phase 6).
// Pages Functions cannot run cron triggers, so this tiny separate Worker does it.
// It reuses the exact export code the app uses (functions/api/_backup.js);
// wrangler bundles the import at deploy time — still no npm build step.
import { backupToR2 } from '../functions/api/_backup.js';

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(backupToR2(env, 'weekly').then(r => console.log('backup ok', JSON.stringify(r))));
  },
  // Manual trigger for testing: GET /?run=1 with header x-backup-token = env.BACKUP_TOKEN
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.BACKUP_TOKEN || url.searchParams.get('run') !== '1' || request.headers.get('x-backup-token') !== env.BACKUP_TOKEN) {
      return new Response('cbse-tutor backup worker. Runs every Sunday 20:00 UTC.\n', { status: 200 });
    }
    const r = await backupToR2(env, 'manual-worker');
    return Response.json({ ok: true, ...r });
  }
};
