// Cloudflare Pages Function for /api/chat. Thin wrapper: the logic is in
// src/chat/server/handler.ts.
import { handleChat } from '../../src/chat/server/handler';
import type { Env } from '../../src/chat/server/env';
import { anthropicClient } from '../../src/chat/server/model';

export { handleChat };

interface Context {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequestPost = (context: Context): Promise<Response> =>
  handleChat(context.request, context.env, anthropicClient(context.env), new Date(), context.waitUntil.bind(context));

export const onRequest = (context: Context): Promise<Response> | Response =>
  context.request.method === 'POST'
    ? onRequestPost(context)
    : new Response(null, { status: 405, headers: { Allow: 'POST' } });
