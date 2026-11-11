// GET /api/ping — public health check.
// Also reports which D1 tables exist so the Phase 0 deliverable
// ("D1 tables exist") can be verified from a browser without wrangler.

const EXPECTED_TABLES = ['users', 'sessions', 'books', 'chapters', 'quiz_cache', 'progress', 'attempts'];

export async function onRequestGet({ env }) {
  const body = { ok: true, time: new Date().toISOString() };

  if (!env.DB) {
    body.d1 = { bound: false };
  } else {
    try {
      const { results } = await env.DB
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")
        .all();
      const tables = results.map(r => r.name);
      body.d1 = {
        bound: true,
        tables,
        missing: EXPECTED_TABLES.filter(t => !tables.includes(t))
      };
    } catch (e) {
      // Never leak internals; the worker itself is still healthy.
      body.d1 = { bound: true, error: 'D1 query failed' };
    }
  }

  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}
