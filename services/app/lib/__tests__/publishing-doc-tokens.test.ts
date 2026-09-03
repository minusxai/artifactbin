/**
 * DISCOVER: references/publishing.md's "no token?" sentence must describe the lifecycle era — it sends the
 * reader to publishing-auth.md and names /tokens/new.
 *
 * m2 INVERTED half of this. It used to assert the sentence names `/api/tokens/anonymous` (it read "or without
 * a human `POST .../api/tokens/anonymous`"). That IS the failure m2 removes: an agent that mints its own token
 * publishes documents its human cannot reach, and this bullet is one of the places that taught it to. The
 * address must now be ABSENT, and the sentence must still hand the reader the two things that do work.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const doc = () => readFileSync(new URL('../../skills/artifactbin/references/publishing.md', import.meta.url), 'utf8');

describe('publishing.md and tokens', () => {
  it('never names the anonymous mint', () => {
    expect(doc()).not.toContain('tokens/anonymous');
  });

  it('points at publishing-auth.md and /tokens/new where it mentions getting a token', () => {
    const text = doc();
    const idx = text.indexOf('No token?');
    expect(idx).toBeGreaterThan(-1);
    const around = text.slice(Math.max(0, idx - 400), idx + 400);
    expect(around).toContain('publishing-auth.md');
    expect(around).toContain('/tokens/new');
  });
});
