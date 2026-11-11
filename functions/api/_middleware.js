// Runs before every /api/* function.
// 1. Turns thrown HttpErrors into JSON (no stack traces leak to the UI).
// 2. Enforces a valid server-side session except on public routes.
// 3. Requires JSON bodies on writes — together with SameSite=Lax cookies
//    this blocks cross-site form posts (CSRF). PUT/DELETE already need a
//    CORS preflight cross-site, so only POST is checked.
import { error, HttpError, getSessionUser } from './_lib.js';

const PUBLIC = new Set(['/api/ping', '/api/signup', '/api/login']);

export async function onRequest(context) {
  const { request, env, data } = context;
  try {
    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    if (request.method === 'POST') {
      const type = request.headers.get('Content-Type') || '';
      if (!type.toLowerCase().startsWith('application/json')) {
        return error(415, 'Requests must be JSON');
      }
    }

    if (!env.DB) return error(503, 'Database is not configured');

    // Signup is public for the very first parent; signup.js checks the rest.
    data.user = await getSessionUser(env, request);
    if (!PUBLIC.has(path) && !data.user) return error(401, 'Please log in');

    return await context.next();
  } catch (e) {
    if (e instanceof HttpError) return error(e.status, e.message, e.extra);
    console.error('Unhandled API error', e && e.stack || e);
    return error(500, 'Something went wrong on the server');
  }
}
