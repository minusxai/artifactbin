/**
 * ONE READABLE SCHEMA, RENDERED. Each package declares its own tables; the schema renderer writes them into
 * SCHEMA.sql / roles.sql / grants.sql at the repo root, and this test fails the build when a checked-in file is stale
 * or when two packages declare one table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderedSchema } from '@/__tests__/rendered-schema';

const ROOT = path.resolve(__dirname, '../../../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const rendered = renderedSchema;

describe('the rendered schema', () => {
  it('SCHEMA.sql is exactly what the renderer produces (regenerate with npm run render:schema)', () => {
    const schema = rendered().schema;
    expect(read('SCHEMA.sql')).toBe(schema);
    const tokens = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS app.tokens'), schema.indexOf('CREATE TABLE IF NOT EXISTS app.artifacts'));
    expect(tokens).toMatch(/expires_at TIMESTAMPTZ[\s\S]*last_used_at TIMESTAMPTZ/);
  });
  it('roles.sql creates two roles and two OWNED schemas, grants USAGE, and grants no table privilege', () => {
    const roles = read('roles.sql');
    expect(roles).toMatch(/CREATE SCHEMA app AUTHORIZATION artifactbin_app/);
    expect(roles).toMatch(/CREATE SCHEMA auth AUTHORIZATION artifactbin_proxy/);
    expect(roles).toMatch(/GRANT USAGE ON SCHEMA app TO artifactbin_proxy/);
    expect(roles).not.toMatch(/ON (ALL )?TABLES?/i);
    expect(roles).not.toMatch(/DEFAULT PRIVILEGES/i);
  });
  it('grants.sql grants the proxy SELECT on app.tokens and nothing else', () => {
    const grants = read('grants.sql').split('\n').filter((l) => /^\s*GRANT/i.test(l));
    expect(grants).toEqual(['GRANT SELECT ON app.tokens TO artifactbin_proxy;']);
  });
  it('every table has exactly one owning package, and the declared set is the literal below', () => {
    const owners = rendered().tables;
    expect(Object.keys(owners).sort()).toEqual(['app.annotations', 'app.artifact_edits', 'app.artifact_shares', 'app.artifact_versions', 'app.artifacts', 'app.analytics_events', 'app.codes', 'app.tokens', 'app.users', 'app.webfonts', 'auth.codes'].sort());
    expect(new Set(Object.values(owners))).toEqual(new Set(['app', 'proxy']));
  });
});

describe('Better Auth in the rendered schema', () => {
  it('SCHEMA.sql carries Better Auth\'s four tables, schema-qualified, and no placeholder', () => {
    const sql = read('SCHEMA.sql');
    for (const t of ['user', 'session', 'account', 'verification']) expect(sql).toMatch(new RegExp(`create table "auth"\\."${t}"`, 'i'));
    expect(sql).not.toMatch(/rendered in wave 3/);
  });
});
