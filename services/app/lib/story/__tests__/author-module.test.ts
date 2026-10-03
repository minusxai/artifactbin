/**
 * THE AUTHOR MODULE BUILD (lib/story/document/author-module.server): the generated `page` module exports the three
 * binders, Solid JSX is compiled at publish over the island build's `solid-js/web`, and every `page` binding is checked
 * against the Helmet's declarations, by name and by kind, before anything is served.
 */
import { describe, expect, it } from 'vitest';
import { buildAuthorModule, pageModuleSource, PAGE_GLOBAL } from '../document/author-module.server';
import { AUTHOR_VENDOR_EXPORTS } from '@/lib/islands/contract';

const NAMES = { values: ['region'], tables: ['sales'], queries: ['monthly'], mutations: ['rename'] };
const built = async (script: string) => {
  const result = await buildAuthorModule(script, NAMES);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.module;
};
const refused = async (script: string) => {
  const result = await buildAuthorModule(script, NAMES);
  if (result.ok) throw new Error('expected a publish error');
  return result.errors.join('\n');
};

describe('the page module generator', () => {
  it('exports exactly signal, query, mutation and proxy, each reading the runtime bindings by the name it is given', () => {
    const source = pageModuleSource();
    expect([...source.matchAll(/export const (\w+)/g)].map((m) => m[1])).toEqual(['signal', 'query', 'mutation', 'proxy']);
    expect(source).toContain('b.proxy(ref)');
    expect(source).toContain(`globalThis[${JSON.stringify(PAGE_GLOBAL)}]`);
    expect(source).toContain('b.signal(ref)');
  });

  it('runs the generated module against bindings: each binder forwards the $name to its kind', async () => {
    const calls: string[] = [];
    (globalThis as Record<string, unknown>)[PAGE_GLOBAL] = {
      signal: (r: string) => { calls.push(`signal ${r}`); return [() => 'west', () => {}]; },
      query: (r: string) => { calls.push(`query ${r}`); return () => []; },
      mutation: (r: string) => { calls.push(`mutation ${r}`); return async () => {}; },
    };
    try {
      const url = `data:text/javascript,${encodeURIComponent(pageModuleSource())}`;
      const page = (await import(/* @vite-ignore */ url)) as { signal: (r: string) => unknown; query: (r: string) => unknown; mutation: (r: string) => unknown };
      page.signal('$region'); page.query('$monthly'); page.mutation('$rename');
      expect(calls).toEqual(['signal $region', 'query $monthly', 'mutation $rename']);
    } finally {
      delete (globalThis as Record<string, unknown>)[PAGE_GLOBAL];
    }
  });
});

describe('buildAuthorModule', () => {
  it('compiles Solid JSX over the vendor solid-js/web, inlines page, and lists the components it exports', async () => {
    const module = await built(`
      import { signal, query, mutation } from 'page';
      import { createEffect, createSignal, For } from 'solid-js';
      const [region, setRegion] = signal('$region');
      const monthly = query('$monthly');
      const sales = query("$sales");
      const rename = mutation(\`$rename\`);
      createEffect(() => { document.title = region() + monthly().length + sales().length; });
      export function Sparkline(props) {
        const [hover, setHover] = createSignal(null);
        return <svg><For each={props.rows}>{(r, i) => <rect onMouseEnter={() => setHover(i())} fill={props.color} />}</For></svg>;
      }
      export const Other = () => <p>{rename.name}</p>;
    `);
    expect(module.exports).toEqual(['Other', 'Sparkline']);
    expect(module.code).toMatch(/from "solid-js\/web"/);
    expect(module.code).toMatch(/from "solid-js"/);
    expect(module.code, 'the page module is inlined').toContain(PAGE_GLOBAL);
    expect(module.code).not.toMatch(/from "page"/);
    expect(module.code, 'no JSX survives: templates and helpers').not.toMatch(/<For |<rect /);
    expect(module.code).toContain('_$template(');
    // Every Solid name the compiled module imports is one the vendor chunk exports.
    for (const [, names, spec] of module.code.matchAll(/import \{([^}]*)\} from "(solid-js(?:\/web|\/store)?)"/g)) {
      const offered = new Set<string>(AUTHOR_VENDOR_EXPORTS[spec as keyof typeof AUTHOR_VENDOR_EXPORTS]);
      for (const name of names!.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]!).filter(Boolean)) expect(offered.has(name), `${spec} ${name}`).toBe(true);
    }
  });

  it('accepts a renamed binder and keeps bare npm names on esm.sh', async () => {
    const module = await built(`import { signal as bind } from 'page'; import confetti from 'canvas-confetti'; const [r] = bind('$region'); confetti(r());`);
    expect(module.code).toContain('https://esm.sh/canvas-confetti');
  });

  it('refuses an undeclared name, a name of the wrong kind, a name without its $ and a computed name', async () => {
    expect(await refused(`import { signal } from 'page'; signal('$regoin');`)).toMatch(/line 1:\d+: signal\('\$regoin'\): the Helmet declares no regoin/);
    expect(await refused(`import { signal } from 'page'; signal('$monthly');`)).toMatch(/monthly is a <Query> or a table <Value>; const monthly = query\('\$monthly'\)/);
    expect(await refused(`import { query } from 'page'; query('$region');`)).toMatch(/region is a scalar <Value>; const \[region, setRegion\] = signal\('\$region'\)/);
    expect(await refused(`import { mutation } from 'page'; mutation('$monthly');`)).toMatch(/monthly is a <Query>/);
    expect(await refused(`import { signal } from 'page'; signal('region');`)).toMatch(/with its \$: signal\('\$region'\)/);
    expect(await refused(`import { signal } from 'page'; const n = '$region'; signal(n);`)).toMatch(/takes one string, the declared name/);
    expect(await refused(`import { query } from 'page'; const q = query; q('$monthly');`)).toMatch(/call query\('\$name'\) directly/);
  });

  it('takes proxy(url) without a declared name: it is a URL, checked by the door at run time', async () => {
    const module = await built(`import { proxy } from 'page';\nexport function Rates() { return fetch(proxy('https://api.example.com/rates')).then((r) => r.json()); }`);
    expect(module.exports).toEqual(['Rates']);
  });

  it('refuses the retired per-name imports with the binder to use instead', async () => {
    expect(await refused(`import { region } from 'page';`)).toMatch(/'page' exports signal, query, mutation, proxy, not region; bind the declared name with const \[region, setRegion\] = signal\('\$region'\)/);
    expect(await refused(`import page from 'page';`)).toMatch(/import from 'page' by name/);
  });

  it('refuses createSignal over a $name: a local signal that only looks bound', async () => {
    const message = await refused(`import { createSignal as make } from 'solid-js';\nconst [r] = make('$region');`);
    expect(message).toMatch(/line 2:\d+: createSignal\("\$region"\) makes a local signal .* bind the declared Value with signal\('\$region'\) from 'page'/);
    // A plain string is just a string.
    await built(`import { createSignal } from 'solid-js'; const [label] = createSignal('price in $');`);
  });

  it('refuses the Preact habits a model falls back to: a Preact or React import, .value on a binding, destructured component props', async () => {
    expect(await refused("import { signal } from 'page'; import { effect } from '@preact/signals'; const [r] = signal('$region'); effect(() => r());"))
      .toMatch(/import "@preact\/signals": a page script is Solid/);
    expect(await refused("import { signal } from 'page'; const [region, setRegion] = signal('$region'); region.value = 'east';"))
      .toMatch(/region\.value: region is a Solid accessor.*read with region\(\); write with setRegion\(v\)/);
    expect(await refused("import { query } from 'page'; const monthly = query('$monthly'); const busy = monthly.loading.value;"))
      .toMatch(/monthly\.loading\.value.*read with monthly\.loading\(\)/);
    expect(await refused("import { query } from 'page'; const rows = query('$monthly'); export function Grid({ rows }) { return <div>{rows.length}</div>; }"))
      .toMatch(/Grid\(\{ … \}\): a Solid component reads its props as props\.name/);
    // The same shapes, written the Solid way, build.
    const ok = await built("import { signal, query } from 'page'; import { createEffect } from 'solid-js'; const [region, setRegion] = signal('$region'); const monthly = query('$monthly'); createEffect(() => { if (!monthly.loading()) setRegion(region()); }); export function Grid(props) { return <div>{props.rows.length}</div>; }");
    expect(ok.exports).toContain('Grid');
  });

  it('refuses a Solid name the vendor chunk does not offer, a relative import and a syntax error, with the line', async () => {
    expect(await refused(`import { createResource } from 'solid-js';`)).toMatch(/'solid-js' offers .* createResource is not among them/);
    expect(await refused(`import { Portal } from 'solid-js/web';`)).toMatch(/Portal is not among them/);
    expect(await refused(`import x from 'solid-js/h';`)).toMatch(/imports Solid as solid-js, solid-js\/web, solid-js\/store/);
    expect(await refused(`import x from './x.js';`)).toMatch(/nothing sits beside the script/);
    expect(await refused(`const a = ;`)).toMatch(/line 1:\d+/);
  });
});
