/**
 * The dev server's bindings, all derived so two checkouts can run at once:
 * the port (PORT → the port inside PUBLIC_BASE_URL → 3030), the HMR websocket
 * port beside it, and the Vite options that must not share a cache directory.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveHmrPort } from '@/lib/config';
import { developmentViteOptions } from '../dev-vite';
import { resolvePort, DEFAULT_DEV_PORT } from '../../../../scripts/lib/dev-env.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('resolvePort', () => {
  it('takes the port out of PUBLIC_BASE_URL', () => {
    expect(resolvePort({ APP__PUBLIC_BASE_URL: 'http://localhost:3040' })).toBe(3040);
  });

  it('lets PORT win over PUBLIC_BASE_URL', () => {
    expect(resolvePort({ APP__PORT: '3050', APP__PUBLIC_BASE_URL: 'http://localhost:3030' })).toBe(3050);
  });

  it('falls back to 3030 when nothing is set', () => {
    expect(resolvePort({})).toBe(DEFAULT_DEV_PORT);
    expect(DEFAULT_DEV_PORT).toBe(3030);
  });

  it('does NOT infer a port from a URL scheme default', () => {
    // A production PUBLIC_BASE_URL carries no port — binding 443 would be absurd.
    expect(resolvePort({ APP__PUBLIC_BASE_URL: 'https://artifactbin.dev' })).toBe(3030);
    expect(resolvePort({ APP__PUBLIC_BASE_URL: 'http://localhost' })).toBe(3030);
  });

  it('ignores junk rather than crashing', () => {
    expect(resolvePort({ APP__PUBLIC_BASE_URL: 'not a url' })).toBe(3030);
    expect(resolvePort({ APP__PORT: 'abc', APP__PUBLIC_BASE_URL: 'http://localhost:3040' })).toBe(3040);
    expect(resolvePort({ APP__PORT: '0' })).toBe(3030);
    expect(resolvePort({ APP__PORT: '99999' })).toBe(3030);
  });
});

describe('resolveHmrPort — Vite HMR websocket port beside the app port', () => {
  it('defaults to the app port + 1, so two checkouts never share Vite\'s 24678', () => {
    expect(resolveHmrPort(undefined, 3050)).toBe(3051);
    expect(resolveHmrPort('', 3030)).toBe(3031);
  });
  it('honours an explicit APP__HMR_PORT', () => {
    expect(resolveHmrPort('24999', 3050)).toBe(24999);
  });
  it('falls back to the default on a value that is not a port', () => {
    expect(resolveHmrPort('abc', 3050)).toBe(3051);
    expect(resolveHmrPort('0', 3050)).toBe(3051);
  });
});

describe('developmentViteOptions', () => {
  it('scans an existing entry relative to the Vite web root', () => {
    for (const entry of developmentViteOptions(appRoot, 7242).optimizeDeps.entries)
      expect(existsSync(path.resolve(appRoot, 'web', entry))).toBe(true);
  });
  it('keeps separate dev servers from replacing each other’s optimized dependencies', () => {
    expect(developmentViteOptions(appRoot, 7242).cacheDir).not.toBe(developmentViteOptions(appRoot, 7284).cacheDir);
  });
});
