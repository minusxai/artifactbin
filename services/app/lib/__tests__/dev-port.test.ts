/**
 * The dev server's port is derived so two checkouts can run at once:
 * PORT → the port inside PUBLIC_BASE_URL → 3030.
 */
import { resolvePort, resolveBaseUrl, DEFAULT_DEV_PORT } from '../../../../scripts/lib/dev-env.mjs';

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

describe('resolveBaseUrl', () => {
  it('prefers an explicit BASE_URL', () => {
    expect(resolveBaseUrl({ BASE_URL: 'https://staging.example.com', APP__PUBLIC_BASE_URL: 'http://localhost:3040' })).toBe(
      'https://staging.example.com',
    );
  });

  it('otherwise talks to PUBLIC_BASE_URL', () => {
    expect(resolveBaseUrl({ APP__PUBLIC_BASE_URL: 'http://localhost:3040' })).toBe('http://localhost:3040');
  });

  it('falls back to localhost on the default dev port', () => {
    expect(resolveBaseUrl({})).toBe('http://localhost:3030');
  });
});
