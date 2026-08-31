/**
 * Nothing the driver PRINTS may contain a provider key, for the same reason
 * nothing it writes may: `codex.prepare()` raises `codex login failed (…): <the
 * CLI's stderr>`, and a CLI that rejects a key routinely echoes it back. That
 * error reaches `console.error` in `main()`, and CI keeps the log.
 */
import { describe, it, expect } from 'vitest';
import { scrubSecrets } from '../lib/secrets';

describe('scrubSecrets', () => {
  it('replaces every occurrence of every secret', () => {
    expect(scrubSecrets('login failed: key sk-abc123 rejected; retry with sk-abc123', ['sk-abc123'])).toBe('login failed: key *** rejected; retry with ***');
  });

  it('handles several secrets and ignores empty ones', () => {
    expect(scrubSecrets('a=sk-one b=fw-two', ['sk-one', '', 'fw-two'])).toBe('a=*** b=***');
  });

  it('leaves text alone when there is nothing to scrub', () => {
    expect(scrubSecrets('nothing here', [])).toBe('nothing here');
    expect(scrubSecrets('nothing here', ['absent'])).toBe('nothing here');
  });

  it('is literal, not a regex — a key with regex metacharacters is still removed', () => {
    expect(scrubSecrets('key sk-a+b.c$d rejected', ['sk-a+b.c$d'])).toBe('key *** rejected');
  });
});
