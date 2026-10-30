/**
 * lib/platform's configuration, through its index and its downstream `config` path: every setting is derived from
 * exactly one `MODULE__NAME` (plus the conventional DATABASE_URL, S3_URL and NODE_ENV), its default when unset, the
 * parsers that refuse a malformed value, the typo report, and the overrides a test may make.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_HMR_PORT_SETTING, deploymentConfig, env, envNamesRead, parseCustomDomainsTarget, requirePagesHost, resolveHmrPort, unknownEnvNames,
} from '@/lib/platform';
import { overrideConfig, parseAliasOrigins, parseDatasetDnsServers, parseDatasetPrivateTargetHashes, parsePagesHost, resetConfigOverrides } from '@/lib/platform/config';

/** A fresh copy of the configuration module, read from exactly these environment variables. */
async function configFrom(environment: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value as string);
  return import('@/lib/platform/config');
}
afterEach(() => { vi.unstubAllEnvs(); resetConfigOverrides(); });
/** Each named export of the configuration and the value it derived (named as data: these exports share retired flat env spellings). */
const expectSettings = (config: Record<string, unknown>, settings: Array<[string, unknown]>) =>
  expect(Object.fromEntries(settings.map(([name]) => [name, config[name]]))).toEqual(Object.fromEntries(settings));

const HASH = 'a'.repeat(64);

describe('settings', () => {
  it('derives every setting from its one MODULE__NAME', async () => {
    const config = await configFrom({
      NODE_ENV: 'production', DATABASE_URL: 'postgres://db.example/app', S3_URL: 's3://bucket', TEST_DOMAIN: undefined,
      APP__PORT: '4100', APP__HMR_PORT: '4200', APP__PUBLIC_BASE_URL: 'https://app.example.com', APP__ASSETS_ORIGIN: 'https://assets.example.com',
      APP__ALIAS_ORIGINS: 'https://alias.example.com', APP__PAGES_HOST: 'Pages.Example.com.',
      ADMIN__SECRET: 'admin', AUTH__SECRET: 'auth', ANALYTICS__SECRET: 'analytics', ARTIFACTS__ALLOW_PUBLIC: '0',
      DATASET__ALLOW_PRIVATE_NETWORKS: 'true', DATASET__DNS_SERVERS: '1.1.1.1, 9.9.9.9', DATASET__PRIVATE_TARGET_HASHES: HASH,
      QUOTA__ARTIFACTS_PER_TOKEN: '7', ASSETS__MAX_BYTES_PER_TOKEN: '8', HTTP__TRUSTED_PROXY_HOPS: '3',
      SQL__MAX_ROWS: '50', SQL__MAX_QUERY_ROWS: undefined, SQL__QUERY_TIMEOUT_MS: '900', SQL__SERVICE_URL: 'http://sql',
      OBJECT_STORE__LOCAL_DIR: '/objects', WEB_INGEST__ALLOW_PRIVATE: '1', WEB_INGEST__TIMEOUT_MS: '11', WEB_INGEST__MAX_PER_HOUR: '12',
      IMAGES__MAX_BYTES: '13', PDF__MAX_BYTES: '14', FILES__MAX_BYTES: '15', EMAIL__RESEND_API_KEY: 'resend',
      EXPORT__INTERNAL_ORIGIN: ' http://export ', FLAG__CUSTOM_DOMAINS: 'Domains.Example.com.', BROWSER__SERVICE_URL: 'http://browser',
      AUTH__SERVICE_URL:'http://auth', INTERNAL__SERVICE_SECRET: 'internal', EVENTS__SERVICE_URL: 'http://events', EVENTS__SCHEMA: 'facts',
      RUNNER__SERVICE_URL: 'http://runner',
    });
    expectSettings(config, [
      ['IS_TEST', false],
      ['IS_DEV', false],
      ['DATABASE_URL', 'postgres://db.example/app'],
      ['S3_URL', 's3://bucket'],
      ['TEST_DOMAIN', undefined],
      ['APP_HMR_PORT_SETTING', '4200'],
      ['PUBLIC_BASE_URL', 'https://app.example.com'],
      ['ASSETS_ORIGIN', 'https://assets.example.com'],
      ['ALIAS_ORIGINS', ['https://alias.example.com']],
      ['ADMIN_SECRET', 'admin'],
      ['AUTH_SECRET', 'auth'],
      ['ANALYTICS_SECRET', 'analytics'],
      ['ALLOW_PUBLIC_VISIBILITY', false],
      ['DATASET_ALLOW_PRIVATE_NETWORKS', true],
      ['DATASET_DNS_SERVERS', ['1.1.1.1', '9.9.9.9']],
      ['DATASET_PRIVATE_TARGET_HASHES', [HASH]],
      ['ARTIFACT_QUOTA_PER_TOKEN', 7],
      ['ASSETS_MAX_BYTES_PER_TOKEN', 8],
      ['TRUSTED_PROXY_HOPS', 3],
      ['MAX_ROWS_LIMIT', 50],
      ['MAX_QUERY_ROWS', 50],
      ['QUERY_TIMEOUT_MS', 900],
      ['SQL_SERVICE_URL', 'http://sql'],
      ['LOCAL_OBJECT_DIR', '/objects'],
      ['WEB_INGEST_ALLOW_PRIVATE', true],
      ['WEB_INGEST_TIMEOUT_MS', 11],
      ['WEB_INGEST_MAX_PER_HOUR', 12],
      ['MAX_IMAGE_BYTES', 13],
      ['MAX_PDF_BYTES', 14],
      ['MAX_FILE_BYTES', 15],
      ['RESEND_API_KEY', 'resend'],
      ['EXPORT_INTERNAL_ORIGIN', 'http://export'],
      ['CUSTOM_DOMAINS_TARGET', 'domains.example.com'],
      ['BROWSER_SERVICE_URL', 'http://browser'],
      ['AUTH_SERVICE_URL','http://auth'], ['INTERNAL_SERVICE_SECRET', 'internal'],
      ['EVENTS_SERVICE_URL', 'http://events'],
      ['EVENTS_SCHEMA', 'facts'],
      ['RUNNER_SERVICE_URL', 'http://runner'],
    ]);
    expect(config.requirePagesHost()).toBe('pages.example.com');
  });

  it('falls back to its defaults when nothing is set', async () => {
    const unset = Object.fromEntries([
      'APP__PORT', 'APP__HMR_PORT', 'APP__PUBLIC_BASE_URL', 'APP__ASSETS_ORIGIN', 'APP__ALIAS_ORIGINS', 'AUTH__SECRET', 'ANALYTICS__SECRET',
      'ARTIFACTS__ALLOW_PUBLIC', 'DATASET__ALLOW_PRIVATE_NETWORKS', 'DATASET__DNS_SERVERS', 'DATASET__PRIVATE_TARGET_HASHES',
      'QUOTA__ARTIFACTS_PER_TOKEN', 'ASSETS__MAX_BYTES_PER_TOKEN', 'HTTP__TRUSTED_PROXY_HOPS', 'SQL__MAX_ROWS', 'SQL__MAX_QUERY_ROWS',
      'SQL__QUERY_TIMEOUT_MS', 'OBJECT_STORE__LOCAL_DIR', 'WEB_INGEST__ALLOW_PRIVATE', 'WEB_INGEST__TIMEOUT_MS', 'WEB_INGEST__MAX_PER_HOUR',
      'IMAGES__MAX_BYTES', 'PDF__MAX_BYTES', 'FILES__MAX_BYTES', 'EXPORT__INTERNAL_ORIGIN', 'FLAG__CUSTOM_DOMAINS', 'EVENTS__SCHEMA',
    ].map(name => [name, undefined]));
    const config = await configFrom({ ...unset, NODE_ENV: 'test' });
    expectSettings(config, [
      ['IS_TEST', true],
      ['IS_DEV', false],
      ['PUBLIC_BASE_URL', 'http://localhost:3030'],
      ['ASSETS_ORIGIN', null],
      ['ALIAS_ORIGINS', []],
      ['AUTH_SECRET', 'dev-only-secret-change-me'],
      ['ANALYTICS_SECRET', 'dev-only-secret-change-me'],
      ['ALLOW_PUBLIC_VISIBILITY', false],
      ['DATASET_ALLOW_PRIVATE_NETWORKS', false],
      ['DATASET_DNS_SERVERS', []],
      ['DATASET_PRIVATE_TARGET_HASHES', []],
      ['ARTIFACT_QUOTA_PER_TOKEN', 1000],
      ['ASSETS_MAX_BYTES_PER_TOKEN', 10_000_000_000],
      ['TRUSTED_PROXY_HOPS', 1],
      ['MAX_ROWS_LIMIT', 10_000],
      ['MAX_QUERY_ROWS', 10_000],
      ['QUERY_TIMEOUT_MS', 5000],
      ['LOCAL_OBJECT_DIR', '.artifact-objects'],
      ['WEB_INGEST_ALLOW_PRIVATE', false],
      ['WEB_INGEST_TIMEOUT_MS', 10_000],
      ['WEB_INGEST_MAX_PER_HOUR', 300],
      ['EXPORT_INTERNAL_ORIGIN', 'http://127.0.0.1:3000'],
      ['CUSTOM_DOMAINS_TARGET', null],
      ['EVENTS_SCHEMA', 'events'],
      ['RUNNER_ACTOR_SECRET', undefined],
    ]);
    expect(config.MAX_IMAGE_BYTES).toBe(config.MAX_PDF_BYTES);
    expect(config.MAX_FILE_BYTES).toBeGreaterThan(0);
  });

  it('opens private web ingest and public visibility in development, and clamps a bad proxy hop count to one', async () => {
    const config = await configFrom({ NODE_ENV: 'development', WEB_INGEST__ALLOW_PRIVATE: undefined, ARTIFACTS__ALLOW_PUBLIC: undefined, HTTP__TRUSTED_PROXY_HOPS: 'many' });
    expectSettings(config, [
      ['IS_DEV', true],
      ['WEB_INGEST_ALLOW_PRIVATE', true],
      ['ALLOW_PUBLIC_VISIBILITY', true],
      ['TRUSTED_PROXY_HOPS', 1],
    ]);
    expect((await configFrom({ HTTP__TRUSTED_PROXY_HOPS: '0' })).TRUSTED_PROXY_HOPS).toBe(1);
  });

  it('refuses to boot without a pages host, naming the setting', async () => {
    const config = await configFrom({ APP__PAGES_HOST: '' });
    expect(() => config.requirePagesHost()).toThrow('APP__PAGES_HOST is required');
    expect(requirePagesHost()).toBe('lvh.me');
  });

  it('refuses malformed dataset network settings at boot', async () => {
    await expect(configFrom({ DATASET__DNS_SERVERS: 'dns.example.com' })).rejects.toThrow('DATASET__DNS_SERVERS');
    await expect(configFrom({ DATASET__PRIVATE_TARGET_HASHES: 'abc' })).rejects.toThrow('DATASET__PRIVATE_TARGET_HASHES');
  });
});

describe('parsers', () => {
  it('reads literal DNS server addresses only', () => {
    expect(parseDatasetDnsServers(undefined)).toEqual([]);
    expect(parseDatasetDnsServers('  ')).toEqual([]);
    expect(parseDatasetDnsServers('1.1.1.1,2606:4700::1111')).toEqual(['1.1.1.1', '2606:4700::1111']);
    expect(Object.isFrozen(parseDatasetDnsServers('1.1.1.1'))).toBe(true);
    for (const bad of ['1.1.1.1,', 'one.one', '1.1.1.1,dns']) expect(() => parseDatasetDnsServers(bad), bad).toThrow();
  });

  it('reads at most 32 unique SHA-256 fingerprints', () => {
    expect(parseDatasetPrivateTargetHashes('')).toEqual([]);
    expect(parseDatasetPrivateTargetHashes(` ${HASH} `)).toEqual([HASH]);
    const many = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(64, '0'));
    expect(parseDatasetPrivateTargetHashes(many.join(','))).toHaveLength(32);
    expect(() => parseDatasetPrivateTargetHashes([...many, 'f'.repeat(64)].join(','))).toThrow();
    expect(() => parseDatasetPrivateTargetHashes(`${HASH},${HASH}`)).toThrow();
    expect(() => parseDatasetPrivateTargetHashes('A'.repeat(64))).toThrow();
  });

  it('reads a bare pages hostname, lowercased and without a trailing dot', () => {
    expect(parsePagesHost(undefined)).toBeNull();
    expect(parsePagesHost(' ')).toBeNull();
    expect(parsePagesHost(' Pages.Example.COM. ')).toBe('pages.example.com');
    for (const bad of ['https://pages.example.com', 'pages.example.com:8080', '*.example.com', 'pages.example.com/x', '-bad.example.com', `${'a'.repeat(64)}.com`]) {
      expect(() => parsePagesHost(bad), bad).toThrow('APP__PAGES_HOST');
    }
  });

  it('reads the custom domains target, empty as off', () => {
    expect(parseCustomDomainsTarget(undefined)).toBeNull();
    expect(parseCustomDomainsTarget('  ')).toBeNull();
    expect(parseCustomDomainsTarget(' Domains.Example.com. ')).toBe('domains.example.com');
  });

  it('reads alias origins as a list', () => {
    expect(parseAliasOrigins(undefined)).toEqual([]);
    expect(parseAliasOrigins('https://a.example.com,https://b.example.com')).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('derives the HMR port from the app port unless a valid one is given', () => {
    expect(resolveHmrPort(undefined, 3030)).toBe(3031);
    expect(resolveHmrPort('', 3030)).toBe(3031);
    expect(resolveHmrPort('4000', 3030)).toBe(4000);
    for (const bad of ['0', '65536', '1.5', 'x', '-1']) expect(resolveHmrPort(bad, 3030), bad).toBe(3031);
    expect(APP_HMR_PORT_SETTING === undefined || typeof APP_HMR_PORT_SETTING === 'string').toBe(true);
  });
});

describe('the deployment', () => {
  it('is public by default and a company deployment names its owner', () => {
    expect(deploymentConfig()).toEqual({ mode: 'public', ownerEmail: undefined });
    overrideConfig({}, { APP__DEPLOYMENT_MODE: 'company', APP__DEPLOYMENT_OWNER_EMAIL: ' Owner@Example.com ' });
    expect(deploymentConfig()).toEqual({ mode: 'company', ownerEmail: 'owner@example.com' });
  });

  it('refuses an unknown mode and a company without a valid owner email', () => {
    overrideConfig({}, { APP__DEPLOYMENT_MODE: 'private' });
    expect(() => deploymentConfig()).toThrow('public or company');
    overrideConfig({}, { APP__DEPLOYMENT_MODE: 'company', APP__DEPLOYMENT_OWNER_EMAIL: 'not-an-email' });
    expect(() => deploymentConfig()).toThrow('APP__DEPLOYMENT_OWNER_EMAIL');
    overrideConfig({}, { APP__DEPLOYMENT_OWNER_EMAIL: undefined });
    expect(() => deploymentConfig()).toThrow('APP__DEPLOYMENT_OWNER_EMAIL');
  });
});

describe('the environment audit', () => {
  it('records every name read, answers an override first, and reports unread names of its shape as typos', () => {
    expect(env('SPEC', 'PROBE')).toBeUndefined();
    expect(envNamesRead().has('SPEC__PROBE')).toBe(true);
    overrideConfig({}, { SPEC__PROBE: 'overridden' });
    expect(env('SPEC', 'PROBE')).toBe('overridden');
    expect(unknownEnvNames({ SPEC__PROBE: '1', AUTH__SECERT: '1', PATH: '/bin', lower__case: '1', NODE_ENV: 'test' })).toEqual(['AUTH__SECERT']);
    expect(unknownEnvNames({ B__X: '1', A__X: '1' }, new Set())).toEqual(['A__X', 'B__X']);
  });
});
