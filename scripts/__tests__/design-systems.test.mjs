import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  it('describes shared system binding through metadata fields for both HTTP and CLI readers', () => {
    for (const slug of ROSTER) {
      expect(systemMd(slug), slug).toContain(`Set the \`theme\` metadata field to \`${slug}\` and \`template\` to the page type.`);
    }
    expect(catalogueMd()).toContain('`template` metadata field');
    expect(catalogueMd()).toContain('`theme` metadata field');
  });
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
  it('lets Phosphor KPI cards fit their grid tracks while preserving desktop spacing and mobile sizing', () => {
    const css = renderRuntime().entries.find((entry) => entry.name === 'phosphor').css;
    const mobile = css.match(/@container \(max-width: 400px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const card = css.match(/\.p-stat\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(card).toMatch(/\bmin-width:\s*0;/);
    expect(card).toMatch(/padding:\s*18px 20px;/);
    expect(css).not.toMatch(/\.p-stat\s*\{[^}]*min-width:\s*200px;/);
    expect(mobile).toMatch(/\.p-stat\s*\{[^}]*padding-inline:\s*clamp\(4px, 1\.8cqw, 12px\);/);
    expect(mobile).not.toMatch(/\.p-stat\s*\{[^}]*min-width:/);
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
    for (const slug of ROSTER) {
      const guide = read(path.join(REFS, `system-${slug}.md`));
      expect(guide, slug).toBe(systemMd(slug));
      expect(guide, slug).toContain('Use `<Markdown>` for long prose on any page type');
      expect(guide, slug).toContain('### Doc\n\nTemplate: doc.');
      expect(guide, slug).toContain('[the Doc guide](templates-doc.md)');
      expect(guide, slug).toContain('inherits this system\'s fonts and colors with a transparent background');
    }
    expect(read(path.join(REFS, 'system-redline.md'))).toContain('`rl-paper`, `rl-red`, `rl-ink` and `rl-on-*` classes set SVG fills only; they do not paint HTML slides. For HTML, use stage classes such as `rl-stage-red`, which set background and text colors.');
  });
});

/**
 * What a system reference tells an agent to paste must be what the runtime serves for that system: a type
 * role the runtime never styles leaves the pasted heading bare, and a value-keyed rule styles only the
 * values someone thought of. Checked against the runtime's own CSS, the thing a published page receives.
 */
describe('a system reference pastes only what its runtime serves', () => {
  const runtime = renderRuntime().entries;
  const rolesServed = (slug) => new Set([...runtime.find((e) => e.name === slug).css.matchAll(/\.t-([a-z0-9-]+)/g)].map((m) => `t-${m[1]}`));
  const rolesNamed = (text) => {
    const inMarkup = [...text.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    const inProse = [...text.matchAll(/`(t-[a-z0-9-]+)`/g)].map((m) => m[1]);
    return [...new Set([...inMarkup, ...inProse])].filter((c) => /^t-[a-z0-9-]+$/.test(c));
  };
  it('names App and Landing by their template field, as Bind it and the page-type guides do', () => {
    for (const slug of ROSTER) {
      const text = systemMd(slug);
      expect(text, slug).not.toContain('without a template field');
      expect(text, slug).toMatch(/### App · \w+\n\nTemplate: app\./);
      expect(text, slug).toMatch(/### Landing · \w+\n\nTemplate: landing\./);
    }
  });
  it('every type role a system reference names is one its runtime styles', () => {
    for (const slug of ROSTER) {
      const served = rolesServed(slug);
      for (const role of rolesNamed(systemMd(slug))) expect(served.has(role), `${slug} names ${role}`).toBe(true);
    }
  });
  it('a Meridian bar fill takes any width, not only the three the specimen used', () => {
    const text = systemMd('meridian');
    const css = runtime.find((e) => e.name === 'meridian').css;
    expect(css).not.toMatch(/\[data-w=/);
    const fills = [...text.matchAll(/<span className="me-bar-fill[^"]*"([^>]*)>/g)].map((m) => m[1]);
    expect(fills.length).toBeGreaterThan(0);
    for (const attrs of fills) expect(attrs).toMatch(/style=\{\{ ?width: '\d+%' ?\}\}/);
  });
  it('the landing skeleton, publishable as is, wears any system: no system-scoped class, only roles every system serves', () => {
    const landing = read(path.join(REFS, 'templates-landing.md'));
    const skeleton = landing.split('Skeleton of the runtime pieces')[1].split('\n## ')[0];
    const classes = [...skeleton.matchAll(/className="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    const prefixes = ROSTER.map((slug) => (loadSpec(slug).css ?? '').match(/\.ds-[a-z]+ \.([a-z]+)-btn\b/)?.[1]).filter(Boolean);
    expect(prefixes).toContain('v');
    for (const c of classes) for (const prefix of prefixes) expect(c.startsWith(`${prefix}-`), `${c} belongs to one system`).toBe(false);
    for (const slug of ROSTER) for (const role of classes.filter((c) => c.startsWith('t-'))) expect(rolesServed(slug).has(role), `${slug} lacks ${role}`).toBe(true);
  });
});

it('keeps native theme font delivery and linked-CSS guides generated from the installed manifest',async()=>{
 const {nativeSystemCss,nativeSystemMd}=await import('../../design-systems/lib/html-skill.mjs');
 for(const name of ROSTER){
  expect(readFileSync(path.join(REPO,'services/app/skills/artifactbin/design-systems',name+'.css'),'utf8')).toBe(nativeSystemCss(name));
  expect(readFileSync(path.join(REFS,'html-system-'+name+'.md'),'utf8')).toBe(nativeSystemMd(name));
 }
});
it('gives every colour token its use in the native guide and keeps text tokens and reports their contrast',async()=>{
 const {nativeSystemMd}=await import('../../design-systems/lib/html-skill.mjs');
 const lum=hex=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4);return 0.2126*r+0.7152*g+0.0722*b;};
 const ratio=(a,b)=>{const [hi,lo]=[lum(a),lum(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);};
 for(const name of ROSTER){
  const S=loadSpec(name),md=nativeSystemMd(name);
  // Agents pick colours from this table; a token's use (fill versus text) must be readable there.
  for(const token of S.tokens)if(token.usage)expect(md).toContain(token.usage);
  // A token described as text for the page itself meets WCAG AA on the main page grounds.
  const grounds=S.tokens.filter(t=>['paper','canvas','surface','card'].includes(t.name));
  for(const token of S.tokens.filter(t=>/text/i.test(t.usage??'')&&!/never (body )?text|text on (it|the)|for text on/i.test(t.usage)&&!/^on-|soft$|night/.test(t.name)))
   for(const mode of ['light','dark'])for(const ground of grounds){
    const fg=mode==='light'?token.light:token.dark??token.light,bg=mode==='light'?ground.light:ground.dark??ground.light;
    if(/^#[0-9a-f]{6}$/i.test(fg)&&/^#[0-9a-f]{6}$/i.test(bg))expect(ratio(fg,bg),`${name} ${mode} ${token.name} on ${ground.name}`).toBeGreaterThanOrEqual(4.5);
   }
 }
});

it('ships variable-only highlight token rules in every system stylesheet, and reports their contrast',async()=>{
 const {nativeSystemCss,TOKEN_RULES}=await import('../../design-systems/lib/html-skill.mjs');
 const {varsMap}=await import('../../design-systems/lib/runtime.mjs');
 const lum=hex=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4);return 0.2126*r+0.7152*g+0.0722*b;};
 const ratio=(a,b)=>{const [hi,lo]=[lum(a),lum(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);};
 const failures=[];
 for(const name of ROSTER){
  const css=nativeSystemCss(name),spec=loadSpec(name);
  for(const [names,rule] of TOKEN_RULES){
   for(const token of names)expect(css,`${name} .tok-${token}`).toContain(`:root[data-af-design-system="${name}"] .tok-${token}`);
   expect(rule).not.toMatch(/#|rgb|hsl|oklch/);
  }
  for(const mode of ['light','dark']){
   const vars=varsMap(spec,mode),resolve=key=>{let v=vars[key];for(let i=0;i<4&&typeof v==='string'&&v.startsWith('var(');i++)v=vars[v.slice(4,-1)];return v;};
   for(const [names,rule] of TOKEN_RULES){
    const variable=/color:var\((--[a-z0-9-]+)\)/.exec(rule)?.[1];if(!variable)continue;
    const fg=resolve(variable);
    for(const ground of ['--background','--muted']){const bg=resolve(ground);
     if(/^#[0-9a-f]{6}$/i.test(fg)&&/^#[0-9a-f]{6}$/i.test(bg)&&ratio(fg,bg)<4.5)failures.push(`${name} ${mode} ${variable} (${names[0]}) on ${ground}: ${ratio(fg,bg).toFixed(2)}`);}
   }
  }
 }
 // Contrast is reported, not enforced: token colours are a mapping decision (several systems use --accent as a fill).
 if(process.env.AF_TOKEN_CONTRAST_REPORT)writeFileSync(process.env.AF_TOKEN_CONTRAST_REPORT,failures.join('\n'));
});
