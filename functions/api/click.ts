// Cloudflare Pages Function for /api/click. Thin wrapper: the logic is in
// src/chat/server/clicks.ts.
import { handleClick } from '../../src/chat/server/clicks';
import type { Env } from '../../src/chat/server/env';

export { handleClick };

interface Context {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequestPost = (context: Context): Promise<Response> =>
  handleClick(context.request, context.env, new Date(), context.waitUntil.bind(context));

export const onRequest = (context: Context): Promise<Response> | Response =>
  context.request.method === 'POST'
    ? onRequestPost(context)
    : new Response(null, { status: 405, headers: { Allow: 'POST' } });
