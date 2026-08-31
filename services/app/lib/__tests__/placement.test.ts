/**
 * testmig-7 seed — where a test lives says what it is.
 *
 * `services/app/__tests__/` is for HTTP routes and full-app composition (the api project). Ten pure config/domain/
 * architecture tests sit there today. Five web UI tests omit the `.ui` suffix and are carried by a directory
 * exception in vitest's config. Two suites duplicate others (`docs-claim` ⊂ `docs`; `schema-tokens-lifecycle`'s DDL
 * strings ⊂ the schema render + upgrade). Three tests read component/markdown SOURCE instead of behaviour. The paste
 * sentence agents receive is asserted character-exact in more than one place. Six pins; red at handoff.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(import.meta.dirname, '../..');
const ROOT = path.resolve(APP, '../..');
const exists = (p: string) => fs.existsSync(path.join(APP, p));
const read = (p: string) => fs.readFileSync(path.join(APP, p), 'utf8');
const allTests = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'dist') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.test\.tsx?$/.test(e.name)) out.push(path.relative(APP, full));
    }
  };
  walk(APP);
  return out.sort();
};
const MISFILED = ['agent-cookie-name', 'agent-guidance', 'anon-mint-dev-default', 'app-layout', 'client-identity', 'export-origin', 'schema-sql-fresh', 'selection-contrast', 'visitor-fingerprint', 'workflows'];

describe('placement', () => {
  it('1. the ten pure tests have left the route directory and live with what they test (lib/**/__tests__ or server/__tests__)', () => {
    const tests = allTests();
    for (const name of MISFILED) {
      expect(exists(`__tests__/${name}.test.ts`), `${name} still at the root`).toBe(false);
      const moved = tests.filter((f) => path.basename(f) === `${name}.test.ts` && (f.startsWith('lib/') || f.startsWith('server/') || f.startsWith('components/')));
      expect(moved.length, `${name}: ${moved.join(', ') || 'nowhere'}`).toBe(1);
    }
  });
  it('2. every web UI test says .ui, and the ui project is selected by suffix alone — no directory exception', () => {
    const web = fs.readdirSync(path.join(APP, 'web/__tests__')).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
    for (const f of web) expect(f, f).toMatch(/\.ui\.test\.tsx?$/);
    const config = fs.readFileSync(path.join(ROOT, 'vitest.config.ts'), 'utf8');
    const ui = config.slice(config.indexOf("name: 'ui'"), config.indexOf("name: 'ui'") + 900);
    const includes = [...ui.matchAll(/'([^']+\.test\.[^']+)'/g)].map((m) => m[1]!);
    expect(includes.length).toBeGreaterThan(0);
    for (const pattern of includes) expect(pattern, pattern).toContain('.ui.test.');
  });
});

describe('deletions and merges', () => {
  it('3. docs-claim is folded into docs — its two cases live there by name', () => {
    expect(exists('__tests__/docs-claim.test.ts')).toBe(false);
    const docs = read('__tests__/docs.test.ts');
    expect(docs).toContain('tells the user how to keep anonymous work under an account');
    expect(docs).toContain('counts the vocabulary instead of restating it');
  });
  it('4. the token-lifecycle DDL strings are gone; the schema render and one legacy-row upgrade own the columns', () => {
    expect(exists('lib/__tests__/schema-tokens-lifecycle.test.ts')).toBe(false);
    expect(read('__tests__/upgrade.test.ts')).toMatch(/last_used_at/);
    const fresh = allTests().find((f) => path.basename(f) === 'schema-sql-fresh.test.ts')!;
    expect(read(fresh)).toMatch(/expires_at/);
  });
  it('5. the paste sentence is asserted character-exact in exactly one test file', () => {
    const files = allTests().filter((f) => f !== 'lib/__tests__/placement.test.ts' && read(f).includes('Help me edit my artifact at '));
    expect(files).toEqual(['lib/__tests__/agent-copy.test.ts']);
  });
  it('6. artifact-page-chrome, app-fonts and agent-contract test behaviour, not source text', () => {
    for (const f of ['lib/__tests__/artifact-page-chrome.test.ts', 'lib/__tests__/app-fonts.test.ts', 'lib/__tests__/agent-contract.test.ts']) {
      const text = read(f);
      expect(text, f).not.toMatch(/readFileSync|from ['"]node:fs['"]/);
    }
  });
});
