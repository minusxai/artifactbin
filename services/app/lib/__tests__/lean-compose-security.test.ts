import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';

const root = path.resolve(import.meta.dirname, '../../../..');
const source = fs.readFileSync(path.join(root, 'docker-compose.lean.yml'), 'utf8');
const compose = yaml.parse(source) as any;

describe('lean compose security boundary', () => {
  it('shares one required service credential between app clients and protected services', () => {
    for (const name of ['app', 'sql', 'browser']) {
      expect(compose.services[name].environment.INTERNAL__SERVICE_SECRET).toContain(':?');
    }
  });

  it('separates the published edge, compute services, and database', () => {
    expect(compose.services.proxy.networks).toEqual(expect.arrayContaining(['edge', 'compute', 'db']));
    expect(Object.keys(compose.services.app.networks)).toEqual(expect.arrayContaining(['compute', 'db', 'egress']));
    expect(compose.services.sql.networks).toEqual(['compute']);
    expect(compose.services.browser.networks).toEqual(['compute']);
    expect(compose.services.postgres.networks).toEqual(['db']);
    expect(compose.networks).toMatchObject({ edge: { internal: false }, compute: { internal: true }, db: { internal: true }, egress: { internal: false } });
  });

  it('does not use trust authentication and hardens stateless services', () => {
    expect(source).not.toContain('POSTGRES_HOST_AUTH_METHOD: trust');
    for (const name of ['proxy', 'app', 'sql', 'browser']) {
      expect(compose.services[name]).toMatchObject({ read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] });
    }
  });
});
