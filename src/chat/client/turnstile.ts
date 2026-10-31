// Lazy Cloudflare Turnstile: the script is loaded only when the visitor first
// interacts with the chat, and the widget is rendered in "interaction-only"
// mode, so it stays invisible unless Cloudflare needs the visitor to click.

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 30_000;

interface TurnstileApi {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface TurnstileClient {
  /** Starts loading the script and rendering the widget. Safe to call often. */
  prepare(): void;
  /** Resolves with a fresh single-use token, or rejects (no site key, error, timeout). */
  getToken(): Promise<string>;
}

type Waiter = { resolve: (token: string) => void; reject: (error: Error) => void };

export function createTurnstile(siteKey: string, container: HTMLElement): TurnstileClient {
  let started = false;
  let widgetId: string | undefined;
  let token: string | null = null;
  let failure: Error | null = null;
  let waiters: Waiter[] = [];

  const settle = (): void => {
    if (token !== null) {
      waiters.shift()?.resolve(take());
    } else if (failure) {
      const pending = waiters;
      waiters = [];
      for (const w of pending) w.reject(failure);
    }
  };

  // Tokens are single-use: hand one out, then ask the widget for the next.
  const take = (): string => {
    const t = token!;
    token = null;
    if (widgetId !== undefined) window.turnstile?.reset(widgetId);
    return t;
  };

  // The script could not be loaded or did not define the API: forget it, so
  // the next prepare()/getToken() loads it again instead of failing for good.
  const loadFailed = (error: Error, script?: HTMLScriptElement): void => {
    started = false;
    script?.remove();
    failure = error;
    settle();
  };

  const render = (): void => {
    const api = window.turnstile;
    if (!api) {
      loadFailed(new Error('turnstile unavailable'));
      return;
    }
    widgetId = api.render(container, {
      sitekey: siteKey,
      appearance: 'interaction-only',
      size: 'flexible',
      callback: (t: string) => {
        token = t;
        failure = null;
        settle();
      },
      'expired-callback': () => {
        token = null;
      },
      // Returning true tells Turnstile the error is handled (no uncaught error is thrown).
      'error-callback': () => {
        failure = new Error('turnstile error');
        settle();
        return true;
      },
    });
  };

  const prepare = (): void => {
    if (started || !siteKey) return;
    started = true;
    if (window.turnstile) {
      render();
      return;
    }
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.addEventListener('load', render);
    script.addEventListener('error', () => loadFailed(new Error('turnstile script failed to load'), script));
    document.head.append(script);
  };

  const getToken = (): Promise<string> => {
    if (!siteKey) return Promise.reject(new Error('no turnstile site key'));
    // A failed script load is not permanent: clear it and load again.
    if (failure && !started) failure = null;
    prepare();
    if (token !== null) return Promise.resolve(take());
    if (failure && widgetId !== undefined) {
      // After a widget error, reset it and wait for a new token.
      failure = null;
      window.turnstile?.reset(widgetId);
    }
    return new Promise<string>((resolve, reject) => {
      const waiter: Waiter = {
        resolve: (t) => {
          clearTimeout(timer);
          resolve(t);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      const timer = setTimeout(() => {
        waiters = waiters.filter((w) => w !== waiter);
        reject(new Error('turnstile timeout'));
      }, TOKEN_TIMEOUT_MS);
      waiters.push(waiter);
      settle();
    });
  };

  return { prepare, getToken };
}
