// Cloudflare Pages Function for /api/contact. Thin wrapper: the logic is in
// src/chat/server/contact.ts.
import { handleContact } from '../../src/chat/server/contact';
import type { Env } from '../../src/chat/server/env';

export { handleContact };

interface Context {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

export const onRequestPost = (context: Context): Promise<Response> =>
  handleContact(context.request, context.env, new Date(), context.waitUntil.bind(context));

export const onRequest = (context: Context): Promise<Response> | Response =>
  context.request.method === 'POST'
    ? onRequestPost(context)
    : new Response(null, { status: 405, headers: { Allow: 'POST' } });
