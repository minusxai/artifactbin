/** Required composition settings and their mode-dependent diagnostics. */
import { describe, expect, it } from 'vitest';
import { bootMode } from '../boot-settings';

const production = {
  NODE_ENV: 'production',
  AUTH__SECRET: 'test-production-secret',
  APP__PUBLIC_BASE_URL: 'https://app.example.com',
  APP__PAGES_HOST: 'pages.example.com',
};

describe('boot settings', () => {
  it('requires a durable auth secret first in production', () => {
    expect(() => bootMode({ NODE_ENV: 'production' })).toThrow(
      '[boot] AUTH__SECRET is required in production (sessions and the agent cookie must survive a restart). Generate one: openssl rand -base64 32 — or run: npm run setup',
    );
  });

  it('requires the public base URL in production', () => {
    expect(() => bootMode({ ...production, APP__PUBLIC_BASE_URL: undefined })).toThrow(
      '[boot] APP__PUBLIC_BASE_URL is required in production (every published link is minted from it). Set it to the URL people reach this on.',
    );
  });

  it.each([
    { ...production, APP__PAGES_HOST: undefined },
    { NODE_ENV: 'development', APP__PAGES_HOST: '' },
  ])('requires a pages host in $NODE_ENV', (env) => {
    expect(() => bootMode(env)).toThrow('[boot] APP__PAGES_HOST is required');
  });

  it('accepts complete production settings and requires only a pages host in development', () => {
    expect(bootMode(production)).toBe('production');
    expect(bootMode({ NODE_ENV: 'development', APP__PAGES_HOST: 'lvh.me' })).toBe('development');
    expect(bootMode({ APP__PAGES_HOST: 'lvh.me' })).toBe('development');
  });
});
