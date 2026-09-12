import { describe, expect, it } from 'vitest';
import { shouldRunCli, overCap, parseArgs, DEFAULT_CAP } from '../test-changed.mjs';

describe('test-changed', () => {
  it('runs the CLI suite only when the diff touches services/cli', () => {
    expect(shouldRunCli(['services/cli/src/push.ts'])).toBe(true);
    expect(shouldRunCli(['services/cli/test/config.test.ts'])).toBe(true);
    expect(shouldRunCli(['services/app/lib/skills/index.ts', 'AGENTS.md'])).toBe(false);
    expect(shouldRunCli([])).toBe(false);
    // A cli-adjacent app path is not the CLI package.
    expect(shouldRunCli(['services/app/__tests__/cli-sync-integration.test.ts'])).toBe(false);
  });

  it('refuses only an over-cap run, and --all always allows it', () => {
    expect(overCap(1, 100, false)).toBe(false);
    expect(overCap(100, 100, false)).toBe(false); // at the cap, still runs
    expect(overCap(101, 100, false)).toBe(true);
    expect(overCap(314, 100, false)).toBe(true);
    expect(overCap(314, 100, true)).toBe(false); // --all ignores the cap
  });

  it('parses args in any order; a bad or missing -n falls back to the default cap', () => {
    expect(parseArgs([])).toEqual({ dry: false, all: false, cap: DEFAULT_CAP, base: undefined });
    expect(parseArgs(['--all'])).toEqual({ dry: false, all: true, cap: DEFAULT_CAP, base: undefined });
    expect(parseArgs(['-n', '250']).cap).toBe(250);
    expect(parseArgs(['-n250']).cap).toBe(250);
    expect(parseArgs(['-n', 'oops']).cap).toBe(DEFAULT_CAP);
    expect(parseArgs(['origin/main']).base).toBe('origin/main');
    expect(parseArgs(['--dry', 'origin/main'])).toEqual({ dry: true, all: false, cap: DEFAULT_CAP, base: 'origin/main' });
  });
});
