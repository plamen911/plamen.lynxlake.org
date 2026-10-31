export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Parses TURNSTILE_HOSTNAMES: comma-separated, trimmed, lower-cased, empties dropped. */
export function parseHostnames(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True if `hostname` is in the allow-list. An entry is an exact hostname, or
 * `*.suffix`, which matches any subdomain of `suffix` (not `suffix` itself).
 */
export function hostnameAllowed(hostname: string, allowed: string[]): boolean {
  const host = hostname.trim().toLowerCase();
  if (host === '') return false;
  return allowed.some((entry) => (entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry));
}

/**
 * Verifies a Turnstile token with Cloudflare. Verified only if siteverify
 * reports success for a hostname in `allowedHostnames`; any other result or
 * failure counts as not verified.
 */
export async function verifyTurnstile(
  secret: string,
  token: string,
  ip: string | null,
  allowedHostnames: string[],
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetchFn(SITEVERIFY_URL, { method: 'POST', body: form });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: unknown; hostname?: unknown };
    return data.success === true && typeof data.hostname === 'string' && hostnameAllowed(data.hostname, allowedHostnames);
  } catch {
    return false;
  }
}
