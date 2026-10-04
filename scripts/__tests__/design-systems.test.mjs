import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOGUE, CONTRACT_KEYS, REPO, ROSTER, STATUS, loadSpec } from '../../design-systems/lib/pages.mjs';
import { faces } from '../../design-systems/lib/fonts.mjs';
import { DATA, NAMES, SHEETS, renderRuntime } from '../../design-systems/lib/runtime.mjs';
import { REFS, catalogueMd, systemMd } from '../../design-systems/lib/skill.mjs';

/**
 * The design-systems generator (scripts/design-systems.mjs) has two committed outputs: the runtime registry
 * the server serves a system from, and the references the agent reads. Both are regenerated here in process
 * and compared to the committed files, so a spec edited without `npm run generate:design-systems` fails CI
 * instead of shipping a registry that disagrees with its reference. The spec shape is checked too, because
 * the generator would happily emit a system that leaves a contract key dangling.
 */
const read = (file) => readFileSync(file, 'utf8');

describe('the specs', () => {
  it('are the roster, each with its slug, every contract key, the status tokens and cached faces', () => {
    const specs = readdirSync(path.join(REPO, 'design-systems', 'specs')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
    expect(specs).toEqual([...ROSTER].sort());
    for (const slug of ROSTER) {
      const S = loadSpec(slug);
      expect(S.slug, slug).toBe(slug);
      for (const key of CONTRACT_KEYS) expect(S.contract[key], `${slug} --${key}`).toBeTruthy();
      const names = new Set(S.tokens.map((t) => t.name));
      for (const key of CONTRACT_KEYS) expect(names.has(S.contract[key]) || S.contract[key] in (S.status_alias ?? {}), `${slug} --${key} points at a token`).toBe(true);
      for (const s of STATUS) expect(names.has(s) || s in (S.status_alias ?? {}), `${slug} status ${s}`).toBe(true);
      for (const tk of S.tokens) { expect(tk.light, `${slug} ${tk.name} light`).toMatch(/^#/); expect(tk.usage, `${slug} ${tk.name} usage`).toBeTruthy(); }
      for (const [family, axes] of S.fonts) expect(faces(family, axes).length, `${slug} ${family}`).toBeGreaterThan(0);
      expect(S.type_roles.length).toBeGreaterThan(0);
      expect(CATALOGUE.fit[slug], `${slug} fit row`).toHaveLength(CATALOGUE.pageTypes.length);
      expect(CATALOGUE.pageIds[slug], `${slug} page id`).toMatch(/^[A-Za-z0-9]{6}$/);
    }
  });
});

describe('the committed outputs are what the generator emits now', () => {
  it('the runtime registry, its sheets and the names leaf', () => {
    const { names, data, sheets } = renderRuntime();
    expect(read(NAMES)).toBe(names);
    expect(read(DATA)).toBe(data);
    expect(read(SHEETS)).toBe(sheets);
  });
  it('the catalogue and every system reference', () => {
    expect(read(path.join(REFS, 'design-systems.md'))).toBe(catalogueMd());
    for (const slug of ROSTER) expect(read(path.join(REFS, `system-${slug}.md`)), slug).toBe(systemMd(slug));
  });
});
