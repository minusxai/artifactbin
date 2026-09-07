/**
 * ONE NAME PER SETTING — `MODULE__NAME`, and nothing else.
 *
 * `env()` used to accept a legacy flat name as a fallback, with a warning. Two
 * spellings for one setting is a trap, and it sprang on the person who owns
 * this repo: a file carrying both, where the namespaced one silently wins and
 * the other looks live. The shim is gone. A retired name is not ignored either
 * — ignoring `AUTH_SECRET` would sign sessions with a per-boot secret and log
 * everyone out for no visible reason — so the process REFUSES TO START and
 * says exactly what to rename.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('lib/config.ts', () => {
  it('reads every env through env(), except DATABASE_URL, S3_URL and NODE_ENV', () => {
    const src = readFileSync(new URL('../config.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const direct = [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    const allowed = new Set(['DATABASE_URL', 'S3_URL', 'NODE_ENV']);
    expect(direct.filter((n) => !allowed.has(n))).toEqual([]);
  });

  it('carries no legacy fallback: env() takes a module and a name, and that is all', () => {
    const src = readFileSync(new URL('../config.ts', import.meta.url), 'utf8');
    expect(src, 'a third argument is a second spelling').not.toMatch(/env\('[A-Z_]+',\s*'[A-Z_0-9]+',\s*'/);
  });
});

describe('env()', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('reads the namespaced name and nothing else', async () => {
    const { env } = await import('../config');
    vi.stubEnv('QUOTA__ARTIFACTS_PER_TOKEN', '7');
    expect(env('QUOTA', 'ARTIFACTS_PER_TOKEN')).toBe('7');
    expect(env('QUOTA', 'NOPE')).toBeUndefined();
  });
});

describe('dataset DNS servers',()=>{
  it('accepts trimmed literal IPv4 and IPv6 servers and treats empty as the OS default',async()=>{
    const {parseDatasetDnsServers}=await import('../config');
    expect(parseDatasetDnsServers(undefined)).toEqual([]);
    expect(parseDatasetDnsServers(' 1.1.1.1, 2606:4700:4700::1111 ')).toEqual(['1.1.1.1','2606:4700:4700::1111']);
  });
  it('rejects hostnames and empty list entries without echoing their values',async()=>{
    const {parseDatasetDnsServers}=await import('../config');
    for(const value of ['resolver.example.com','1.1.1.1,,8.8.8.8','1.1.1.1,']){
      expect(()=>parseDatasetDnsServers(value)).toThrow('DATASET__DNS_SERVERS must contain only literal DNS server IP addresses.');
      try{parseDatasetDnsServers(value);}catch(error){expect(String(error)).not.toContain(value);}
    }
  });
});

describe('a retired name', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('is reported with the name that replaced it, never silently ignored', async () => {
    const { retiredEnvNamesInUse } = await import('../config');
    const found = retiredEnvNamesInUse({ AUTH_SECRET: 'x', RESEND_API_KEY: 'y', AUTH__SCHEMA: 'auth' });
    expect(found).toEqual([
      { retired: 'AUTH_SECRET', replacement: 'AUTH__SECRET' },
      { retired: 'RESEND_API_KEY', replacement: 'EMAIL__RESEND_API_KEY' },
    ]);
  });

  it('says nothing when the environment is clean', async () => {
    const { retiredEnvNamesInUse } = await import('../config');
    expect(retiredEnvNamesInUse({ AUTH__SECRET: 'x', DATABASE_URL: 'pglite://memory' })).toEqual([]);
  });

  it('leaves the two deliberate exceptions alone — they are the current names', async () => {
    const { retiredEnvNamesInUse } = await import('../config');
    expect(retiredEnvNamesInUse({ DATABASE_URL: 'x', S3_URL: 'y' })).toEqual([]);
  });
});

describe('a name nothing reads', () => {
  it('is reported — a typo looks exactly like a setting that does nothing', async () => {
    const { unknownEnvNames } = await import('../config');
    const read = new Set(['AUTH__SECRET', 'EMAIL__FROM']);
    const found = unknownEnvNames({ AUTH__SECRET: 'x', AUTH__SECERT: 'typo', EMAIL__FROM: 'a@b' }, read);
    expect(found).toEqual(['AUTH__SECERT']);
  });

  it('says nothing about the machine\'s own environment', async () => {
    const { unknownEnvNames } = await import('../config');
    const found = unknownEnvNames(
      { PATH: '/usr/bin', HOME: '/root', NODE_ENV: 'production', DATABASE_URL: 'x', S3_URL: 'y', npm_package_name: 'z' },
      new Set(),
    );
    expect(found).toEqual([]);
  });
});

/**
 * FALSE POSITIVES ARE THE ONLY WAY THIS NOTICE DIES. It fired on `APP__PORT`,
 * which IS read — but only inside a `??` right-hand side, so another setting
 * could prevent evaluating it and the name looked unread.
 * Two rules keep it honest: config reads every setting AT MODULE LOAD (the
 * house style anyway — config-read-once), and the door knobs, which are
 * consumed by prefix rather than by name, are known by that prefix.
 */
describe('the unread notice does not cry wolf', () => {
  it('config.ts reads every setting eagerly — no env() behind a ??', () => {
    const src = readFileSync(new URL('../config.ts', import.meta.url), 'utf8');
    // A read on the RIGHT of `??` happens only when the left side is unset, so
    // the name never reaches `envNamesRead` on a deployment that set the left.
    // Comment lines are skipped by SHAPE — stripping `//` would cut every URL
    // in half, which is how this check first passed while the fault was there.
    const lazy = src.split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .filter((line) => {
        const fallback = line.indexOf('??');
        return fallback !== -1 && line.indexOf('env(', fallback) !== -1;
      });
    expect(lazy, 'a name read only on an untaken path reports as unread').toEqual([]);
  });

  it('names a knob from the retired door vocabulary — every rate-limit number lives in a policy file now', async () => {
    const { unknownEnvNames } = await import('../config');
    const found = unknownEnvNames(
      { RATE_LIMITER__LOGIN_SEND_MAX: '5', RATE_LIMITER__QUERY_KEY: 'ip', WOBBLE__THING: 'x' },
      new Set(),
    );
    expect(found, 'a leftover per-door knob is LOUD, not exempted by a prefix').toEqual(['RATE_LIMITER__LOGIN_SEND_MAX', 'RATE_LIMITER__QUERY_KEY', 'WOBBLE__THING']);
  });
});
