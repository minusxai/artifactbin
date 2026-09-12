// THE README IS A FRONT DOOR (node S3): six sections in order, the two
// one-liners, the essays in docs/. Seeded RED by the orchestrator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readme = () => read('README.md');
describe('README.md', () => {
  it('is short and has exactly the six sections, in order', () => {
    expect(readme().split('\n').length).toBeLessThanOrEqual(90);
    expect(readme().split('\n').filter((l) => /^## /.test(l))).toEqual(['## Use it now', '## Self-host', '## Develop', '## Docs', '## License']);
    expect(readme().split('\n')[0]).toBe('# artifactbin');
  });
  it('carries the two one-liners, the hosted instance and the license', () => {
    expect(readme()).toContain('curl -fsSL https://artifactbin.dev/install.sh | bash');
    // `npm ci`, not `npm install`: AGENTS.md makes the pinned install the one
    // documented way in, and a populated tree can hide a broken lockfile.
    expect(readme()).toMatch(/git clone https:\/\/github\.com\/minusxai\/artifactbin[\s\S]*npm ci[\s\S]*npm run setup[\s\S]*npm run dev/);
    expect(readme()).not.toMatch(/^npm install$/m);
    expect(readme()).toContain('npm run setup -- --yes --port <port>');
    expect(readme()).toContain('curl -fsS http://localhost:3030/health');
    expect(readme()).toContain('https://artifactbin.dev');
    expect(readme()).toContain('Apache-2.0');
    expect(readme()).toContain('ghcr.io/minusxai/artifactbin');
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
});

describe('license', () => {
  it('the root package.json declares Apache-2.0 like every service does', () => {
    expect(JSON.parse(read('package.json')).license).toBe('Apache-2.0');
  });
});
