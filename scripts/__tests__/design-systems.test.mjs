import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPage, CATALOGUE, CONTRACT_KEYS, REPO, ROSTER, STATUS, loadSpec } from '../../design-systems/lib/pages.mjs';
import { faces } from '../../design-systems/lib/fonts.mjs';
import { DATA, NAMES, SHEETS, renderRuntime, varsMap } from '../../design-systems/lib/runtime.mjs';
import { pickerSpecimen } from '../../design-systems/lib/picker.mjs';

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
});


it('keeps the shipped stylesheets generated from the specs',async()=>{
 const {nativeSystemCss}=await import('../../design-systems/lib/html-skill.mjs');
 for(const name of ROSTER){
  expect(readFileSync(path.join(REPO,'services/app/skills/artifactbin/design-systems',name+'.css'),'utf8')).toBe(nativeSystemCss(name));
  expect(existsSync(path.join(REPO,'services/app/skills/artifactbin/references','html-system-'+name+'.md')),'the per-system guides are gone: the stylesheet documents itself').toBe(false);
 }
});
it('keeps the HTML platform stylesheet data generated from the same specs and token rules',async()=>{
 const {renderHtmlSystems,HTML_SYSTEMS_FILE,HTML_SYSTEM_MODES_FILE,nativeSystemRules}=await import('../../design-systems/lib/html-skill.mjs');
 const {data,modes}=renderHtmlSystems();
 expect(readFileSync(HTML_SYSTEMS_FILE,'utf8')).toBe(data);
 expect(readFileSync(HTML_SYSTEM_MODES_FILE,'utf8')).toBe(modes);
 for(const name of ROSTER)expect(data).toContain(JSON.stringify(nativeSystemRules(name)));
});
it('annotates every colour token with its use in the stylesheet and keeps text tokens AA',async()=>{
 const {nativeSystemCss}=await import('../../design-systems/lib/html-skill.mjs');
 const lum=hex=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4);return 0.2126*r+0.7152*g+0.0722*b;};
 const ratio=(a,b)=>{const [hi,lo]=[lum(a),lum(b)].sort((x,y)=>y-x);return (hi+0.05)/(lo+0.05);};
 for(const name of ROSTER){
  const S=loadSpec(name),css=nativeSystemCss(name);
  // Agents open the stylesheet to pick colours; a token's use (fill versus text) is written beside its value.
  for(const token of S.tokens)if(token.usage)expect(css).toMatch(new RegExp(`--ds-${token.name}: [^;]+; /\\* ${token.usage.replace(/\s+/g,' ').trim().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} \\*/`));
  // The opening comment documents the contract every system shares and this system's type roles.
  const header=css.slice(0,css.indexOf('*/'));
  for(const key of ['--background','--foreground','--primary','--chart-1','--chart-5','--radius','--font-display','--font-body','--font-mono','t-display-xl','artifactbin:design-system'])expect(header,`${name} header ${key}`).toContain(key);
  for(const role of S.type_roles)expect(css,`${name} t-${role.name}`).toMatch(new RegExp(`/\\* [^*]*${role.size.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[^*]*\\*/\\n:root\\[data-af-design-system="${name}"\\] \\.t-${role.name} `));
  // A token described as text for the page itself meets WCAG AA on the main page grounds.
  const grounds=S.tokens.filter(t=>['paper','canvas','surface','card'].includes(t.name));
  for(const token of S.tokens.filter(t=>/text/i.test(t.usage??'')&&!/never (body )?text|text on (it|the)|for text on/i.test(t.usage)&&!/^on-|soft$|night/.test(t.name)))
   for(const mode of ['light','dark'])for(const ground of grounds){
    const fg=mode==='light'?token.light:token.dark??token.light,bg=mode==='light'?ground.light:ground.dark??ground.light;
    if(/^#[0-9a-f]{6}$/i.test(fg)&&/^#[0-9a-f]{6}$/i.test(bg))expect(ratio(fg,bg),`${name} ${mode} ${token.name} on ${ground.name}`).toBeGreaterThanOrEqual(4.5);
   }
 }
});

it('ships highlight token rules in every system stylesheet, each AA-readable on --background and --muted in both modes',async()=>{
 const {nativeSystemCss}=await import('../../design-systems/lib/html-skill.mjs');
 const {varsMap}=await import('../../design-systems/lib/runtime.mjs');
 const {TOKEN_RULES,tokenContrasts}=await import('../../design-systems/lib/token-colors.mjs');
 const KEYS=['--background','--muted','--foreground','--primary','--chart-1','--chart-2','--chart-3','--chart-4','--destructive','--muted-foreground'];
 const palettes=[];
 for(const name of ROSTER){
  const css=nativeSystemCss(name),spec=loadSpec(name);
  for(const rule of TOKEN_RULES)for(const token of rule.names)expect(css,`${name} .tok-${token}`).toContain(`:root[data-af-design-system="${name}"] .tok-${token}`);
  expect(css).not.toMatch(/\.tok-[^{]*\{[^}]*(#[0-9a-f]{3}|rgb|hsl|oklch)/i);
  for(const mode of ['light','dark']){
   const vars=varsMap(spec,mode),resolve=key=>{let v=vars[key];for(let i=0;i<5&&typeof v==='string'&&v.startsWith('var(');i++)v=vars[v.slice(4,-1)];return v;};
   const palette=Object.fromEntries(KEYS.map(key=>[key,resolve(key)]));
   for(const [key,value] of Object.entries(palette))expect(value,`${name} ${mode} ${key} must be a 6-digit hex for verification`).toMatch(/^#[0-9a-f]{6}$/i);
   palettes.push({name,mode,palette});
  }
 }
 const worst=(rule)=>Math.min(...palettes.flatMap(({palette})=>tokenContrasts(rule,palette)));
 for(const rule of TOKEN_RULES.filter(r=>r.hue)){
  expect(worst(rule),`${rule.names[0]} (${rule.hue} ${rule.mix}%) AA`).toBeGreaterThanOrEqual(4.5);
  // The percentage is the largest that passes: one point more hue would fail somewhere.
  if(rule.mix<100)expect(worst({...rule,mix:rule.mix+1}),`${rule.names[0]} mix is maximal`).toBeLessThan(4.5);
 }
});

it('lists every design system in SKILL.md with its mood and fit, as the specs state them',()=>{
 const skill=readFileSync(path.join(REPO,'services/app/skills/artifactbin/SKILL.md'),'utf8');
 for(const name of ROSTER){
  const spec=loadSpec(name);
  expect(skill,name).toContain(`| \`${name}\` | ${spec.mood} | ${spec.jobs} |`);
 }
 // Nothing tells an agent to copy or link the stylesheet or fonts: the head meta is the whole binding.
 expect(skill).toContain('artifactbin:design-system');
 expect(skill).not.toMatch(/data-af="design-system"|copy[^.\n]*design-systems\/|link[^.\n]*design-systems\/NAME/);
});
