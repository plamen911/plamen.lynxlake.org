// Cloudflare Pages Function for /api/feedback. Thin wrapper: the logic is in
// src/chat/server/feedback.ts.
import { handleFeedback } from '../../src/chat/server/feedback';
import type { Env } from '../../src/chat/server/env';

export { handleFeedback };

interface Context {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequestPost = (context: Context): Promise<Response> =>
  handleFeedback(context.request, context.env, new Date(), context.waitUntil.bind(context));

export const onRequest = (context: Context): Promise<Response> | Response =>
  context.request.method === 'POST'
    ? onRequestPost(context)
    : new Response(null, { status: 405, headers: { Allow: 'POST' } });
