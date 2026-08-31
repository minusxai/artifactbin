// THE README IS A FRONT DOOR (node S3): six sections in order, the two
// one-liners, no retired env name, the essays in docs/. Seeded RED by the orchestrator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readme = () => read('README.md');
const retired = () => {
  const src = read('services', 'app', 'lib', 'config.ts');
  const block = src.slice(src.indexOf('RETIRED_ENV_NAMES'), src.indexOf('};', src.indexOf('RETIRED_ENV_NAMES')));
  return [...block.matchAll(/^\s*([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
};

describe('README.md', () => {
  it('is short and has exactly the six sections, in order', () => {
    expect(readme().split('\n').length).toBeLessThanOrEqual(90);
    expect(readme().split('\n').filter((l) => /^## /.test(l))).toEqual(['## Use it now', '## Self-host', '## Develop', '## Docs', '## License']);
    expect(readme().split('\n')[0]).toBe('# artifact-bin');
  });
  it('carries the two one-liners, the hosted instance and the license', () => {
    expect(readme()).toContain('curl -fsSL https://artifactbin.dev/install.sh | bash');
    expect(readme()).toMatch(/git clone https:\/\/github\.com\/minusxai\/artifactbin[\s\S]*npm install[\s\S]*npm run setup[\s\S]*npm run dev/);
    expect(readme()).toContain('npm run setup -- --yes --port <port>');
    expect(readme()).toContain('curl -fsS http://localhost:3030/health');
    expect(readme()).toContain('https://artifactbin.dev');
    expect(readme()).toContain('Apache-2.0');
    expect(readme()).toContain('ghcr.io/minusxai/artifactbin');
  });
  it('names no retired env name', () => {
    const names = retired();
    expect(names.length).toBeGreaterThan(3);
    for (const n of names) expect(readme(), n).not.toMatch(new RegExp(`(^|[^A-Z_])${n}([^A-Z_]|$)`, 'm'));
  });
});

describe('docs/', () => {
  it('holds the essays the README used to carry', () => {
    for (const f of ['editing.md', 'document-format.md', 'serving-and-security.md', 'ownership.md', 'operations.md']) {
      expect(fs.existsSync(path.join(ROOT, 'docs', f)), f).toBe(true);
      expect(read('docs', f).length, f).toBeGreaterThan(400);
      expect(readme(), f).toContain(`docs/${f}`);
    }
  });
  it('operations.md speaks only namespaced names', () => {
    for (const n of retired()) expect(read('docs', 'operations.md'), n).not.toMatch(new RegExp(`(^|[^A-Z_])${n}=`, 'm'));
  });
});

describe('license', () => {
  it('the root package.json declares Apache-2.0 like every service does', () => {
    expect(JSON.parse(read('package.json')).license).toBe('Apache-2.0');
  });
});
