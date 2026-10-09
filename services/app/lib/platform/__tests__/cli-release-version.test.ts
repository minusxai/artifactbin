import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLI_RELEASE_CANDIDATES, readCliReleaseVersion } from '../config';

describe('the released CLI pointer', () => {
  it('is found through this source tree when the working directory is somewhere else', () => {
    const candidates = CLI_RELEASE_CANDIDATES();
    expect(candidates[1]).toMatch(/services\/app\/public\/chat\/release\.json$/);
    expect(readCliReleaseVersion([candidates[1]])).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('skips candidates that are missing or malformed and yields an empty version when none parses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    writeFileSync(join(dir, 'empty.json'), '{"version":""}');
    writeFileSync(join(dir, 'good.json'), '{"version":"9.9.9","protocol":1}');
    expect(readCliReleaseVersion([join(dir, 'missing.json'), join(dir, 'bad.json'), join(dir, 'empty.json'), join(dir, 'good.json')])).toBe('9.9.9');
    expect(readCliReleaseVersion([join(dir, 'missing.json')])).toBe('');
  });
});
