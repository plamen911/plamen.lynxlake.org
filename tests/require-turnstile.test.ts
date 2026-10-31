import { describe, expect, it } from 'vitest';
import { missingTurnstileError } from '../scripts/require-turnstile.mjs';

describe('production build guard for the Turnstile site key', () => {
  it('fails when the key is missing or blank', () => {
    expect(missingTurnstileError({})).toMatch(/PUBLIC_TURNSTILE_SITE_KEY is empty/);
    expect(missingTurnstileError({ PUBLIC_TURNSTILE_SITE_KEY: '  ' })).toMatch(/ALLOW_MISSING_TURNSTILE=1/);
    expect(missingTurnstileError({ ALLOW_MISSING_TURNSTILE: 'true' })).not.toBeNull();
  });

  it('passes with a key, or with ALLOW_MISSING_TURNSTILE=1', () => {
    expect(missingTurnstileError({ PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' })).toBeNull();
    expect(missingTurnstileError({ ALLOW_MISSING_TURNSTILE: '1' })).toBeNull();
  });
});
