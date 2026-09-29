/**
 * A COMPILED WRITE CONTROL, END TO END THROUGH THE SHIPPED BUILD (w3-behaviour).
 *
 * Server half: the compiler generates the page and its SSR module renders it (fixtures/compiled-island.server.ts,
 * the shared build's real server half). Browser half: the generated islands compiled `generate: 'dom'`,
 * hydratable, and evaluated against the SHIPPED browser chunks (public/islands: `@mx/rt`, `@mx/kit/*`), then
 * hydrated in place by that runtime — what a reader's browser runs.
 *
 * A `<Button run>` renders today's served state (disabled, "Checking edit access…" as its description and
 * beside it); once the store's check answers the refusal leaves — the served sibling is the island's own,
 * not a static neighbour the runtime keeps — and a click performs the mutation.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateModule } from '@/lib/compiled-page/bundle.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { IslandRef } from '@/lib/compiled-page/contract';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
const PUBLIC = path.join(ROOT, 'services/app/public');

interface ServerHalf { html: string; islands: string; browserCode: string; islandRefs: IslandRef[]; flow: CompiledDataflow }
function serverHalf(source: string): ServerHalf {
  const out = execFileSync(path.join(ROOT, 'node_modules/.bin/tsx'), ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-island.server.ts', source, '--shipped'], { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString('utf8')) as ServerHalf;
}

/** The shipped browser chunk for an island specifier (public/islands/manifest.json). */
async function shipped(spec: string): Promise<Record<string, unknown>> {
  const manifest = JSON.parse(readFileSync(path.join(PUBLIC, 'islands/manifest.json'), 'utf8')) as { manifest: Record<string, string> };
  const url = manifest.manifest[spec];
  if (!url) throw new Error(`the island build has no ${spec}`);
  return import(/* @vite-ignore */ pathToFileURL(path.join(PUBLIC, url)).href) as Promise<Record<string, unknown>>;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('a compiled <Button run> through the shipped runtime', () => {
  it('serves today\'s pending state, drops the refusal once the check answers, and writes on click', async () => {
    const server = serverHalf('<Helmet><Value name="drafts" type="table" value={[{"id":1}]} /><Query name="n">{`select count(*) as c from drafts`}</Query>'
      + '<Mutation name="add">{`insert into drafts values (2)`}</Mutation><Mutation name="add2">{`insert into drafts values (3)`}</Mutation><Mutation name="add3">{`insert into drafts values (4)`}</Mutation><Mutation name="add4">{`insert into drafts values (5)`}</Mutation></Helmet><div id="w"><p id="before">Static</p><Button run="$add" id="b">Add</Button><Button run="$add2" id="b2">Add 2</Button><Button run="$add3" id="b3">Add 3</Button><Button run="$add4" id="b4">Add 4</Button><p id="c">{$n.c}</p></div>');
    const host = document.createElement('div');
    host.innerHTML = server.html;
    document.body.append(host);
    expect(host.querySelector('script[data-mx-island-literals]')).not.toBeNull();
    const literalKey = /data-mx-island-literals="([0-9a-f]{16})"/.exec(server.browserCode)?.[1];
    expect(host.querySelector(`script[data-mx-island-literals="${literalKey}"]`)).not.toBeNull();
    const pageData = document.createElement('script');
    pageData.id = 'mx-story-data'; pageData.type = 'application/json';
    pageData.textContent = host.querySelector('script[data-mx-module-data]')?.textContent ?? '{}';
    document.body.append(pageData);
    const served = host.querySelector('#b')!;
    expect(served.hasAttribute('disabled')).toBe(true);
    expect(served.getAttribute('aria-description')).toBe('Checking edit access…');
    expect(served.closest('[data-slot="tooltip-trigger"]')?.getAttribute('aria-description')).toBe('Checking edit access…');
    expect(host.textContent).not.toContain('Checking edit access…');

    const rt = await shipped('@mx/rt');
    const kits = new Map<string, Record<string, unknown>>();
    for (const spec of new Set([...server.islands.matchAll(/from "(@mx\/kit\/[a-z-]+)"/g)].map((m) => m[1]!))) kits.set(loadCompilerBuild().manifest[spec]!, await shipped(spec));
    let tree: unknown = null;
    await evaluateModule(server.browserCode, (spec) => spec === loadCompilerBuild().manifest['@mx/rt'] ? rt : spec === loadCompilerBuild().manifest['@mx/boot'] ? { boot: (value: { TREE: unknown }) => { tree = value.TREE; } } : kits.get(spec) ?? (() => { throw new Error(`unexpected import ${spec}`); })(), 'test/islands.js');
    // The page's doors, answered here: the write check allows `add`, and a write is recorded.
    const written: unknown[] = [];
    const transport = {
      run: async () => ({ tables: {}, errors: {}, mutationAccess: { add: null, add2: null, add3: null, add4: null } }),
      page: async () => ({ rows: [], columns: [] }),
      mutate: async (request: unknown) => { written.push(request); return { dataset: 'local' }; },
    };
    const runtime = (rt.createIslandRuntime as (d: unknown, s: (i: unknown) => unknown) => { context: unknown; store: { start(): void; dispose(): void } | null; dispose(): void })(
      { dataflow: { flow: server.flow }, viewer: null }, (input) => (rt.createDataflowStore as (i: unknown, o: unknown) => unknown)(input, { transport }));
    runtime.store?.start();
    const dispose = (rt.hydrateDocument as (c: unknown, x: unknown, p: ParentNode) => (() => void) | null)(tree, runtime.context, host);
    const button = host.querySelector<HTMLButtonElement>('#b')!;
    for (let i = 0; i < 50 && button.disabled; i++) await new Promise((r) => setTimeout(r, 20));
    expect(button, 'the served button is adopted').toBe(served);
    // The check answered: the refusal the server drew leaves, and only one of it ever existed.
    expect(button.getAttribute('aria-description')).toBeNull();
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-description')).toBe(false);
    expect([...host.querySelectorAll('span')].filter((s) => /Checking edit access/.test(s.textContent ?? ''))).toEqual([]);
    expect(host.querySelector('#before')?.nextElementSibling?.contains(button)).toBe(true);

    const writes: string[] = [];
    (runtime.store as unknown as { subscribeWrites(fn: (e: { type: string; name: string }) => void): void }).subscribeWrites((e) => writes.push(`${e.type}:${e.name}`));
    button.click();
    await tick();
    expect(writes[0]).toBe('write:add');
    for (const id of ['b2', 'b3', 'b4']) {
      const next = host.querySelector<HTMLButtonElement>(`#${id}`)!;
      for (let i = 0; i < 50 && next.disabled; i++) await new Promise((r) => setTimeout(r, 20));
      next.click();
      await tick();
    }
    expect(written).toHaveLength(4);
    expect(written.map(request => (request as { mutation: string }).mutation)).toEqual(['add', 'add2', 'add3', 'add4']);
    dispose?.();
    runtime.dispose();
    pageData.remove();
    host.remove();
  });
});
