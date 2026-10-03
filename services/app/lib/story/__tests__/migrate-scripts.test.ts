/**
 * THE SCRIPT MIGRATION (lib/story/document/migrate-scripts, run by scripts/migrate-scripts.mjs): each retired
 * contract's document, before and after (fixtures/migrate-scripts), one rule per fixture. Every output is a fixpoint,
 * a document already on the Solid contract is never touched, and what it rewrites builds and validates as the Solid
 * contract publishes it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx/parse';
import { migrateDocumentScripts, scopeCss } from '@/lib/story/document/migrate-scripts';
import { validateMarkupStructure } from '@/lib/story/document/local-validation';
import { authorModuleNames, buildAuthorModule } from '@/lib/story/document/author-module.server';

const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures/migrate-scripts', name), 'utf8');
const PAIRS = ['page-signals', 'mx-bridge', 'iframe', 'iframe-library', 'preact-component'];

describe('each fixture migrates to its after file, and the after file is a fixpoint', () => {
  it.each(PAIRS)('%s', (name) => {
    const before = fixture(`${name}.before.jsx`);
    const after = fixture(`${name}.after.jsx`);
    const first = migrateDocumentScripts(before);
    expect(first.changed).toBe(true);
    expect(first.source).toBe(after);
    const second = migrateDocumentScripts(after);
    expect(second.changed).toBe(false);
    expect(second.source).toBe(after);
  });

  it('never touches a document already on the Solid contract, nor one without a script', () => {
    for (const source of [fixture('solid-contract.jsx'), '<p>no script</p>', '<Helmet><title>t</title></Helmet><p>x</p>']) {
      expect(migrateDocumentScripts(source)).toEqual({ source, changed: false, applied: [], unresolved: [] });
    }
  });
});

describe('the rules', () => {
  it("binds `import { … } from 'page'` by declared kind and turns `.value` into accessors and setters", () => {
    const { source, unresolved } = migrateDocumentScripts(fixture('page-signals.before.jsx'));
    expect(unresolved).toEqual([]);
    expect(source).toContain("import { signal, query, mutation } from 'page';");
    expect(source).toContain("const [clicks, setClicks] = signal('$clicks');");
    expect(source).toContain("const monthly = query('$monthly');");
    expect(source).toContain("const bump = mutation('$bump');");
    expect(source).toContain("addEventListener('click', () => { setClicks(clicks() + 1); });"); // x.value = x.value + 1
    expect(source).toContain('setClicks(clicks() + (2)); setClicks(clicks() + 1);'); // x.value += 2; x.value++
    expect(source).toContain('monthly.loading()');
    expect(source).toContain('monthly.error()');
    expect(source).toContain('monthly.ready.then');
    expect(source).toContain('createMemo(() => monthly().reduce');
    expect(source).toContain("import { createEffect, createMemo } from 'solid-js';");
    expect(source).not.toMatch(/\.value\b|@preact\/signals/);
  });

  it('turns the mx bridge into setters, mutation bindings and the snapshot adapter, and marks what has no equivalent', () => {
    const { source, unresolved } = migrateDocumentScripts(fixture('mx-bridge.before.jsx'));
    expect(source).toContain('await setCount(Number(snapshot.signals.count.value ?? 0) + 1);');
    expect(source).toContain("await batch(() => { setCount(0); setLabel('reset'); });");
    expect(source).toContain('await save({ count: 3 });');
    expect(source).toContain("mxSubscribe(['count', 'results'], (snapshot) =>");
    expect(source).toContain("await mxRead(['results'], { wait: true })");
    expect(source).not.toMatch(/mx\.(read|set|subscribe|mutate)\(/);
    // Inside the Helmet's template literal, the note's backticks are escaped.
    expect(source).toContain('/* MIGRATE: \\`mx.describe()\\` has no equivalent');
    expect(unresolved).toEqual([expect.stringContaining('`mx.describe()` has no equivalent')]);
  });

  it('inlines a managed Iframe: children into the body, style scoped into the Helmet, script merged in a block', () => {
    const { source, unresolved } = migrateDocumentScripts(fixture('iframe.before.jsx'));
    expect(unresolved).toEqual([]);
    expect(source).not.toContain('<Iframe');
    expect(source).toContain('{/* migrated from Iframe */}\n<div id="Ab3d" role="group" aria-label="Counter canvas" style={{ minHeight: \'220px\' }}>');
    expect(source).toContain('.lede { font-weight: 600; }\n/* migrated from Iframe "Counter canvas" */\n#Ab3d {margin:16px;font:16px system-ui} #Ab3d canvas, #Ab3d button');
    expect(source).toContain('/* migrated from Iframe "Counter canvas" (#Ab3d) */');
    expect(source).toContain("const [count, setCount] = signal('$count');");
  });

  it('keeps an inlined Iframe\'s id intact when it holds a double quote', () => {
    const { source, unresolved } = migrateDocumentScripts(`<Helmet><title>t</title></Helmet><Iframe id='a"b' title="T"><p>x</p><script>{\`console.log(1)\`}</script></Iframe>`);
    expect(unresolved).toEqual([]);
    const parsed = parseJsx(source);
    expect(parsed.ok).toBe(true);
    const div = parsed.ok ? parsed.nodes.find((n) => n.type === 'element' && n.tag === 'div') : undefined;
    expect(div?.type === 'element' && div.attributes.find((a) => a.name === 'id')?.value).toMatchObject({ static: true, json: 'a"b' });
  });

  it('leaves an Iframe it cannot inline where it is, marked, and changes nothing else', () => {
    const before = fixture('iframe-library.before.jsx');
    const { source, unresolved } = migrateDocumentScripts(before);
    expect(unresolved).toEqual([expect.stringContaining('loads a classic library by <script src>')]);
    const mark = source.match(/\{\/\* MIGRATE: [^\n]*\*\/\}\n/)![0];
    expect(source.replace(mark, '')).toBe(before);
    expect(source.indexOf(mark)).toBe(before.indexOf('<Iframe'));
  });

  it('rewrites the page bindings of a Preact component script but marks the component code for a person', () => {
    const { source, unresolved } = migrateDocumentScripts(fixture('preact-component.before.jsx'));
    expect(source).toContain('console.log(monthly().length);');
    expect(source).toContain("/* MIGRATE: 'preact/hooks' is Preact/React");
    expect(source).toContain('/* MIGRATE: a component destructures its props');
    expect(unresolved).toHaveLength(2);
  });

  it('reports a document it cannot parse instead of guessing', () => {
    const result = migrateDocumentScripts('<p>unclosed');
    expect(result.changed).toBe(false);
    expect(result.unresolved).toEqual([expect.stringContaining('does not parse')]);
  });
});

describe('what it writes publishes under the Solid contract', () => {
  it.each(['page-signals', 'mx-bridge', 'iframe'])('%s validates and its script builds', async (name) => {
    const after = fixture(`${name}.after.jsx`);
    const { errors, split } = validateMarkupStructure(after);
    expect(errors).toEqual([]);
    const built = await buildAuthorModule(split!.content.script!, authorModuleNames(split!.content));
    expect(built.ok ? [] : built.errors).toEqual([]);
  });
});

describe('scoping an inlined frame\'s CSS', () => {
  it('turns body, html and :root into the scope, prefixes every other selector, and scopes nested at-rules only', () => {
    expect(scopeCss('body{margin:0} html body p, :root{x:y} a:not(.b,.c){color:red}', '#f'))
      .toBe('#f{margin:0} #f p, #f{x:y} #f a:not(.b,.c){color:red}');
    expect(scopeCss('@media (min-width: 1px){ body{a:b} } @keyframes k{from{a:b}} @font-face{font-family:x}', '#f'))
      .toBe('@media (min-width: 1px){ #f{a:b} } @keyframes k{from{a:b}} @font-face{font-family:x}');
    expect(scopeCss('/* c */ p::before{content:"}{"}', '#f')).toBe('/* c */ #f p::before{content:"}{"}');
  });
});
