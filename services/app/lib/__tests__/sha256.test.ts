/**
 * The browser-safe sha256 must be THE sha256 — a second implementation that
 * disagreed would put `/assets/<hash>` addresses in the served document that
 * the server's own rows do not carry, and every one of them would look like a
 * missing object rather than a hash mismatch. So it is pinned against
 * `node:crypto` on the shapes it actually meets (urls, unicode, the block
 * boundaries at 55/56/63/64 bytes where padding goes wrong).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256Hex } from '@/lib/sha256';

const node = (s: string) => createHash('sha256').update(s).digest('hex');

const CASES = [
  '',
  'abc',
  'https://minusx.ai/use_cases/growth_v2.webp',
  'https://picsum.photos/id/237/300/200',
  'https://example.test/' + 'a'.repeat(500),
  'héllo — unicode ✓',
  'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65),
];

describe('sha256Hex', () => {
  it('agrees with node:crypto', () => {
    for (const c of CASES) expect(sha256Hex(c), JSON.stringify(c.slice(0, 40))).toBe(node(c));
  });
  it('is 64 lowercase hex characters', () => {
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
