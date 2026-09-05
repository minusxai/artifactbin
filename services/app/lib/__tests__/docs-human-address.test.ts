/**
 * The human docs address is `/docs-human`, everywhere a person can click; `/docs` and below are agents' only.
 * Static parity over the source, so a link cannot quietly point back at the old page. Seeded RED by the orchestrator.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(__dirname, '../..'); // services/app
const read = (rel: string) => fs.readFileSync(path.join(APP, rel), 'utf8');
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['node_modules', '__tests__', 'dist'].includes(entry.name)) walk(full, out); }
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const code = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the human docs address', () => {
  it('every human link points at /docs-human', () => {
    for (const f of ['components/LandingFooter.tsx', 'components/PageChrome.tsx', 'web/pages/TokensNew.tsx', 'web/App.tsx', 'lib/story/reader-chrome.ts']) {
      expect(code(read(f)), f).toContain('/docs-human');
    }
  });
  it('nothing but the redirect still names /docs/human', () => {
    const offenders = ['app', 'components', 'lib', 'server', 'web'].flatMap((d) => walk(path.join(APP, d)))
      .filter((f) => code(fs.readFileSync(f, 'utf8')).includes('/docs/human'))
      .map((f) => path.relative(APP, f));
    expect(offenders).toEqual(['server/app.ts']);
  });
  it('the docs server never sniffs Accept', () => {
    expect(code(read('lib/skills/serve.ts'))).not.toContain('text/html');
  });
  it('the shell head names /docs for agents', () => {
    const html = read('web/index.html');
    expect(html).toMatch(/<link rel="help" href="\/docs" title="[^"]+"/);
    expect(html).toMatch(/<meta name="artifactbin:agent" content="[^"]*\/docs[^"]*"/);
  });
});
