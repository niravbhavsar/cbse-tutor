// Workers AI helpers. Model ids can be overridden with env vars so prompts
// can be tuned without code changes. AI_MOCK=1 (local .dev.vars only) returns
// canned output so the UI can be tested without spending the daily quota.
import { HttpError } from './_lib.js';

export const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

export function isMock(env) {
  return env.AI_MOCK === '1';
}

function requireAi(env) {
  if (!env.AI) throw new HttpError(503, 'Workers AI is not configured');
}

function asText(res) {
  if (res === null || res === undefined) return '';
  if (typeof res === 'string') return res;
  if (typeof res.response === 'string') return res.response;
  if (res.response && typeof res.response === 'object') return JSON.stringify(res.response);
  return JSON.stringify(res);
}

export async function runText(env, prompt, { maxTokens = 2500, system } = {}) {
  requireAi(env);
  const model = env.AI_TEXT_MODEL || TEXT_MODEL;
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  try {
    return asText(await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: 0.4 }));
  } catch (e) {
    console.error('AI text error', e);
    throw new HttpError(502, 'The AI service is busy or over today\'s free limit. Try again later.');
  }
}

// Llama 3.2 Vision needs a one-time license acceptance ("agree") per account.
export async function runVision(env, bytes, prompt) {
  requireAi(env);
  const model = env.AI_VISION_MODEL || VISION_MODEL;
  const input = { messages: [{ role: 'user', content: prompt }], image: [...bytes], max_tokens: 2048 };
  try {
    return asText(await env.AI.run(model, input));
  } catch (e) {
    if (/agree/i.test(String(e && e.message))) {
      await env.AI.run(model, { prompt: 'agree' });
      return asText(await env.AI.run(model, input));
    }
    console.error('AI vision error', e);
    throw new HttpError(502, 'Vision OCR is unavailable right now');
  }
}

// LLMs sometimes wrap JSON in prose or fences; recover the first JSON value.
export function extractJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const tryParse = s => { try { return JSON.parse(s); } catch { return undefined; } };
  let v = tryParse(cleaned);
  if (v !== undefined) return v;
  const start = cleaned.search(/[\[{]/);
  if (start < 0) return undefined;
  const open = cleaned[start], close = open === '{' ? '}' : ']';
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return undefined;
  const slice = cleaned.slice(start, end + 1);
  v = tryParse(slice);
  if (v !== undefined) return v;
  return tryParse(slice.replace(/,\s*([}\]])/g, '$1'));   // trailing commas
}
