// Cloudflare Pages Function for /api/stats. Thin wrapper: the logic is in
// src/chat/server/stats.ts.
import { handleStats } from '../../src/chat/server/stats';
import type { Env } from '../../src/chat/server/env';

export { handleStats };

interface Context {
  request: Request;
  env: Env;
}

export const onRequestGet = (context: Context): Promise<Response> => handleStats(context.env, new Date());

export const onRequest = (context: Context): Promise<Response> | Response =>
  context.request.method === 'GET'
    ? onRequestGet(context)
    : new Response(null, { status: 405, headers: { Allow: 'GET' } });
