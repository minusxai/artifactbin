import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { advertisedCliVersion, CLI_LAST_SERVICE_VERSION, CLI_RELEASE_CANDIDATES, CLI_RETIREMENT_VERSION, cliReleaseVersion, cliRetirementEnabled, overrideConfig, readCliReleaseVersion, resetConfigOverrides } from '../config';

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

describe('the CLI retirement switch', () => {
  afterEach(() => resetConfigOverrides());
  it('is off by default: the retirement release is not advertised, the last service release is', () => {
    overrideConfig({}, { CLI__RETIREMENT: undefined });
    expect(cliRetirementEnabled()).toBe(false);
    expect(advertisedCliVersion(CLI_RETIREMENT_VERSION)).toBe(CLI_LAST_SERVICE_VERSION);
    expect(cliReleaseVersion()).not.toBe(CLI_RETIREMENT_VERSION);
    expect(advertisedCliVersion('0.5.54')).toBe('0.5.54');
    expect(advertisedCliVersion('0.6.1'), 'a later fix to the retirement build stays gated too').toBe(CLI_LAST_SERVICE_VERSION);
  });
  it('advertises the retirement release once CLI__RETIREMENT=on', () => {
    overrideConfig({}, { CLI__RETIREMENT: 'on' });
    expect(cliRetirementEnabled()).toBe(true);
    expect(advertisedCliVersion(CLI_RETIREMENT_VERSION)).toBe(CLI_RETIREMENT_VERSION);
    expect(cliReleaseVersion()).toBe(readCliReleaseVersion());
  });
  it('treats any other value as off', () => {
    overrideConfig({}, { CLI__RETIREMENT: 'true' });
    expect(advertisedCliVersion(CLI_RETIREMENT_VERSION)).toBe(CLI_LAST_SERVICE_VERSION);
  });
});
