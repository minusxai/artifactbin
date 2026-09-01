/**
 * DISCOVER: references/publishing.md's "no token?" sentence must describe the lifecycle era — it sends the reader to
 * publishing-auth.md and names /tokens/new; it must not describe the anonymous mint as the whole story. Seeded RED.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const doc = () => readFileSync(new URL('../../skills/artifactbin/references/publishing.md', import.meta.url), 'utf8');

describe('publishing.md and tokens', () => {
  it('points at publishing-auth.md and /tokens/new where it mentions getting a token', () => {
    const text = doc();
    const idx = text.indexOf('/api/tokens/anonymous');
    expect(idx).toBeGreaterThan(-1);
    const around = text.slice(Math.max(0, idx - 400), idx + 400);
    expect(around).toContain('publishing-auth.md');
    expect(around).toContain('/tokens/new');
  });
});
