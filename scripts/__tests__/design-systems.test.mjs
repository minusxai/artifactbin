import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPage, CATALOGUE, CONTRACT_KEYS, REPO, ROSTER, STATUS, loadSpec } from '../../design-systems/lib/pages.mjs';
import { faces } from '../../design-systems/lib/fonts.mjs';
import { DATA, NAMES, SHEETS, renderRuntime, varsMap } from '../../design-systems/lib/runtime.mjs';
import { pickerSpecimen } from '../../design-systems/lib/picker.mjs';
import { REFS, catalogueMd, systemMd } from '../../design-systems/lib/skill.mjs';

/**
 * The design-systems generator (scripts/design-systems.mjs) has two committed outputs: the runtime registry
 * the server serves a system from, and the references the agent reads. Both are regenerated here in process
 * and compared to the committed files, so a spec edited without `npm run generate:design-systems` fails CI
 * instead of shipping a registry that disagrees with its reference. The spec shape is checked too, because
 * the generator would happily emit a system that leaves a contract key dangling.
 */
const read = (file) => readFileSync(file, 'utf8');

describe('specimens use the same system binding as authored documents', () => {
  it('preserves identity while delegating system CSS and fonts to the runtime', () => {
    for (const slug of ROSTER) {
      const page = buildPage(loadSpec(slug), '---\nid: abc123\nhead_version: 8\ntheme: null\n---\n');
      expect(page.split('---\n')[1]).toContain(`theme: ${slug}\n`);
      expect(page).toContain('id: abc123\n');
      expect(page).toContain('head_version: 8\n');
      const helmet = page.split('</Helmet>')[0];
      expect(helmet).not.toContain('@font-face');
      expect(helmet).not.toContain('--background:');
      expect(helmet).not.toContain('.t-display-xl {');
      expect(page).toContain(`className="@container ds ds-${slug} text-foreground"`);
    }
  });
});

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
  it('keeps Almanac band arches inside the mobile page surface while preserving the desktop tilt', () => {
    const css = renderRuntime().entries.find((entry) => entry.name === 'almanac').css;
    const mobile = css.match(/@container \(max-width: 440px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(mobile).toMatch(/\.al-band\.al-arch\s*\{[^}]*transform:\s*none;/);
    expect(mobile).toMatch(/\.al-band\.al-arch:hover\s*\{[^}]*transform:\s*none;/);
    expect(css).toMatch(/@container \(min-width: 760px\) \{[\s\S]*?\.al-arch\s*\{\s*transform:\s*rotate\(-6deg\);/);
  });

  it('lets Almanac outcome cards shrink to their desktop grid tracks', () => {
    const css = renderRuntime().entries.find((entry) => entry.name === 'almanac').css;
    const outcomeRule = css.match(/\.al-outcome\s*\{([^}]*)\}/)?.[1];
    expect(outcomeRule).toMatch(/\bmin-width:\s*0;/);
    expect(outcomeRule).not.toMatch(/\bmin-width:\s*200px;/);
    expect(css).toMatch(/\.al-outcomes\s*\{[^}]*grid-template-columns:\s*1fr 1fr 1fr;/);
  });
  it('lets Phosphor KPI cards fit narrow grid tracks while preserving their desktop minimum', () => {
    const css = renderRuntime().entries.find((entry) => entry.name === 'phosphor').css;
    const mobile = css.match(/@container \(max-width: 400px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(css).toMatch(/\.p-stat\s*\{[^}]*min-width:\s*200px;/);
    expect(mobile).toMatch(/\.p-stat\s*\{[^}]*min-width:\s*0;[^}]*padding-inline:\s*clamp\(4px, 1\.8cqw, 12px\);/);
    expect(mobile).toMatch(/\.p-stat \.t-numeral\s*\{[^}]*font-size:\s*clamp\(18px, 10cqw, 40px\);/);
  });
  it('retains cover grounds after comments and resolves every drawing token in both modes', () => {
    for (const slug of ROSTER) {
      const spec = loadSpec(slug);
      const { css } = pickerSpecimen(spec);
      for (const mode of ['light', 'dark']) {
        const defined = new Set([...Object.keys(varsMap(spec, 'light')), ...Object.keys(varsMap(spec, mode)), ...css.matchAll(/(--[\w-]+)\s*:/g)].map(x => typeof x === 'string' ? x : x[1]));
        for (const [, token] of css.matchAll(/var\((--[\w-]+)/g)) expect(defined.has(token), `${slug} ${mode} resolves ${token}`).toBe(true);
      }
    }
    expect(pickerSpecimen(loadSpec('dossier')).css).toContain('.do-paper { fill: var(--ds-paper); }');
    expect(pickerSpecimen(loadSpec('redline')).css).toContain('.rl-paper { fill: var(--ds-paper); }');
  });
  it('keeps the editor gallery faithful to the catalogue without importing page layout or active markup', () => {
    for (const slug of ROSTER) {
      const specimen = pickerSpecimen(loadSpec(slug));
      expect(specimen.svg).toContain('<svg');
      expect(specimen.svg).not.toMatch(/className=|textAnchor=|clipPath=|<script|<foreignObject|\son\w+=/);
      expect(specimen.css).not.toMatch(/display:|grid-template|margin:|background:|animation:|\.ds-/);
      expect(specimen.css).toContain(`[data-design-specimen="${slug}"]`);
    }
  });
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
