// Cloudflare Pages middleware for every request: sends www.plamen.lynxlake.org
// to the canonical host plamen.lynxlake.org with a permanent redirect, keeping
// the path and query. The lynxlake.org DNS zone is not on Cloudflare, so a
// zone Redirect Rule is not available; the Pages project serves both custom
// domains and the redirect happens here instead.
const CANONICAL_HOST = 'plamen.lynxlake.org';
const WWW_HOST = `www.${CANONICAL_HOST}`;

interface Context {
  request: Request;
  next: () => Promise<Response>;
}

/** The redirect for a www request, or null when the request is already on another host. */
export function wwwRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.hostname !== WWW_HOST) return null;
  url.hostname = CANONICAL_HOST;
  url.protocol = 'https:';
  url.port = '';
  // 301 for GET/HEAD; 308 keeps the method and body of anything else (e.g. POST /api/chat).
  const status = request.method === 'GET' || request.method === 'HEAD' ? 301 : 308;
  return new Response(null, {
    status,
    headers: { Location: url.toString(), 'Cache-Control': 'public, max-age=86400' },
  });
}

export const onRequest = (context: Context): Promise<Response> | Response =>
  wwwRedirect(context.request) ?? context.next();
