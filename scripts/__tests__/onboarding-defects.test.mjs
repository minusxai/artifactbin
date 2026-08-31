// THE ONBOARDING DEFECTS (node S4): one port story, no stale text, a
// generator hint for every secret. Seeded RED by the orchestrator. The
// production boot-error tests live beside server.ts's existing boot tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

describe('one port story', () => {
  it('docker-compose.yml publishes and mints links on the same port (3030 by default)', () => {
    const web = yaml.parse(read('docker-compose.yml')).services.web;
    expect(web.ports.some((p) => String(p).includes('${APP__PORT:-3030}:3000'))).toBe(true);
    expect(web.environment.APP__PUBLIC_BASE_URL).toBe('http://localhost:${APP__PORT:-3030}');
  });
  it('config.ts falls back to the same default port as dev-env.mjs (3030)', () => {
    const src = read('services', 'app', 'lib', 'config.ts');
    expect(src).not.toMatch(/PUBLIC_BASE_URL[^\n]*\?\?\s*'http:\/\/localhost:3000'/);
    expect(src).toMatch(/PUBLIC_BASE_URL[^\n]*3030|APP__PORT[^\n]*3030/);
  });
  it('CLAUDE.md agrees: npm run dev is on 3030', () => {
    const line = read('CLAUDE.md').split('\n').find((l) => /npm run dev\b/.test(l) && /localhost:\d+/.test(l));
    expect(line).toBeDefined();
    expect(line).toContain('localhost:3030');
  });
});

describe('no stale text, no dead code', () => {
  it('config.ts no longer claims the runner refuses to start on retired names', () => {
    expect(read('services', 'app', 'lib', 'config.ts')).not.toMatch(/REFUSES TO START/);
  });
  it('mint.mjs has no dead fallback', () => {
    expect(read('scripts', 'mint.mjs')).not.toMatch(/ADMIN__SECRET \?\? process\.env\.ADMIN__SECRET/);
  });
  it('.env.example gives a generator hint for ADMIN__SECRET too', () => {
    const lines = read('.env.example').split('\n');
    const i = lines.findIndex((l) => /^ADMIN__SECRET=/.test(l));
    expect(i).toBeGreaterThan(0);
    expect(lines.slice(Math.max(0, i - 4), i).join('\n')).toMatch(/openssl rand -base64 32|npm run setup/);
  });
});
