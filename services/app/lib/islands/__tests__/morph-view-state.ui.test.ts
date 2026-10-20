/**
 * THE LIVE MORPH KEEPS THE READER'S VIEW STATE (lib/islands/morph/engine, lib/story-runtime/comment-state): a kit
 * element's chosen tab or open disclosure is running Solid state, and the version the morph draws must show it. The
 * page here is compiled by the server half and hydrated by the SHIPPED boot and kit, as a reader's page is; the
 * fragment answers as the story door does, rendered at whatever view state the morph asks for.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateModule } from '@/lib/compiled-page/bundle.server';
import { loadCompilerBuild } from '@/lib/compiled-page/build.server';
import { morphStory } from '../morph/engine';
import { ISLAND_DOCUMENT_KEY, type IslandDocument } from '../contract';
import { STORY_VIEW_PARAM } from '@/lib/story-runtime/story-fragment';
import { registerCommentState } from '@/lib/story-runtime/comment-state';

const ROOT = path.resolve(import.meta.dirname, '../../../../..');
type Fixture = { html: string; browserCode: string };

const source = (lede: string) => `<p id="lede">${lede}</p>`
  + '<Tabs defaultValue="a" id="outer"><TabsList id="outer-list"><TabsTrigger value="a" id="o-a">Outer A</TabsTrigger><TabsTrigger value="b" id="o-b">Outer B</TabsTrigger></TabsList>'
  + '<TabsContent value="a" id="o-ca"><p>Panel A</p></TabsContent><TabsContent value="b" id="o-cb">'
  + '<Tabs defaultValue="x" id="inner"><TabsList id="inner-list"><TabsTrigger value="x" id="i-x">Inner X</TabsTrigger><TabsTrigger value="y" id="i-y">Inner Y</TabsTrigger></TabsList>'
  + '<TabsContent value="x" id="i-cx"><p>Panel X</p></TabsContent><TabsContent value="y" id="i-cy"><p>Panel Y</p></TabsContent></Tabs></TabsContent></Tabs>'
  + '<Collapsible id="more"><CollapsibleTrigger id="more-toggle">More</CollapsibleTrigger><CollapsibleContent id="more-body"><p>Details</p></CollapsibleContent></Collapsible>';
/** What the reader holds once they chose Outer B, Inner Y, Outer A and opened the disclosure. */
const READER_VIEW = { 'outer:value': 'a', 'inner:value': 'y', 'more:open': true };

const compiled: Record<'before' | 'after' | 'afterAtView', Fixture> = {} as never;
beforeAll(async () => {
  const compile = async (markup: string, ...args: string[]) => {
    const { stdout } = await promisify(execFile)(path.join(ROOT, 'node_modules/.bin/tsx'),
      ['--tsconfig', path.join(ROOT, 'tsconfig.json'), 'lib/islands/__tests__/fixtures/compiled-island.server.ts', markup, '--shipped', ...args],
      { cwd: path.join(ROOT, 'services/app'), maxBuffer: 64 * 1024 * 1024 });
    return JSON.parse(stdout) as Fixture;
  };
  [compiled.before, compiled.after, compiled.afterAtView] = await Promise.all([
    compile(source('Before')), compile(source('After')), compile(source('After'), `--view=${JSON.stringify(READER_VIEW)}`),
  ]);
}, 120_000);

const manifest = () => loadCompilerBuild().manifest;
const shipped = async (specifier: string): Promise<Record<string, unknown>> =>
  import(/* @vite-ignore */ pathToFileURL(path.resolve(ROOT, 'services/app/public', manifest()[specifier]!.slice(1))).href) as Promise<Record<string, unknown>>;

/** A served page as the assembler writes it (the parts boot and the morph read), its module at `module`. */
const page = (edit: string, story: string, module: string) => '<!doctype html><html><head><title>Live</title></head>'
  + `<body data-mx-live-id="doc1" data-mx-live-edit="${edit}"><div id="mx-story-root" data-mx-inline-story="" data-mx-story-root="">${story}</div>`
  + `<script type="module" src="${module}" crossorigin></script></body></html>`;

async function run(code: string, name: string): Promise<Record<string, unknown>> {
  const [rt, boot, tabs, disclosure] = await Promise.all([shipped('@mx/rt'), shipped('@mx/boot'), shipped('@mx/kit/tabs'), shipped('@mx/kit/disclosure')]);
  return evaluateModule(code, (spec) => spec.includes('/rt-') ? rt : spec.includes('/boot-') ? boot
    : spec.includes('/kit-tabs-') ? tabs : spec.includes('/kit-disclosure-') ? disclosure
    : (() => { throw new Error(`unexpected import ${spec}`); })(), name);
}

/** Load the first version and boot it with the shipped runtime, as the reader's browser does. */
async function open(): Promise<void> {
  const parsed = new DOMParser().parseFromString(page('e1', compiled.before.html, '/islands/d/aaaaaaaaaaaaaaaa.js'), 'text/html');
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  for (const attr of parsed.body.attributes) document.body.setAttribute(attr.name, attr.value);
  await run(compiled.before.browserCode, 'test/view-before.js');
}

/** The story door: the next version at the view state the request names (none: the defaults). */
const door = (module: string) => vi.fn(async (url: string) => {
  const asked = new URL(url, 'http://test').searchParams.get(STORY_VIEW_PARAM);
  if (asked && JSON.stringify(JSON.parse(asked)) !== JSON.stringify(READER_VIEW)) throw new Error(`unexpected view state ${asked}`);
  return new Response(page('e2', (asked ? compiled.afterAtView : compiled.after).html, module), { status: 200 });
});

const $ = (id: string) => document.getElementById(id)!;
const selected = (id: string) => $(id).getAttribute('aria-selected');
const panelShown = (id: string) => $(id).getAttribute('data-state') === 'active' && !$(id).hasAttribute('hidden');

afterEach(() => {
  ((document.querySelector('[data-mx-inline-story]') as unknown as Record<string, IslandDocument | undefined>)?.[ISLAND_DOCUMENT_KEY])?.dispose();
  document.body.innerHTML = '';
  for (const attr of [...document.body.attributes]) document.body.removeAttribute(attr.name);
});

describe('a live update keeps the reader\'s view state', () => {
  /** The reader's clicks before the new version lands: Outer B, Inner Y, Outer A, then the disclosure open. */
  const choose = () => {
    $('o-b').click(); $('i-y').click(); $('o-a').click(); $('more-toggle').click();
    expect(selected('i-y')).toBe('true');
    expect($('more').getAttribute('data-state')).toBe('open');
  };
  /** The page after the update answers the reader: what they chose is drawn, and every tab and the disclosure still respond. */
  const responds = () => {
    expect($('lede').textContent).toBe('After');
    expect(selected('o-a')).toBe('true');
    expect(selected('i-y'), 'the inner tab the reader chose stays chosen').toBe('true');
    expect(panelShown('i-cy')).toBe(true);
    expect($('more').getAttribute('data-state')).toBe('open');
    $('o-b').click();
    $('i-x').click();
    expect(panelShown('i-cx')).toBe(true);
    $('i-y').click();
    expect(selected('i-y')).toBe('true');
    expect(panelShown('i-cy')).toBe(true);
    expect(panelShown('i-cx')).toBe(false);
    $('more-toggle').click();
    expect($('more').getAttribute('data-state')).toBe('closed');
    expect($('more-body').hasAttribute('hidden')).toBe(true);
  };

  it('a text edit under the running tree draws its tabs and disclosure as the reader left them, and they keep responding', async () => {
    await open();
    choose();
    // A text edit builds the same module: the running tree is kept and the new DOM is drawn under it.
    const fetch = door('/islands/d/aaaaaaaaaaaaaaaa.js');
    await morphStory(window, { surface: 'raw', fetch, importModule: vi.fn() });
    expect(fetch).toHaveBeenCalledOnce();
    responds();
  });

  it('a version hydrated anew starts where the reader was', async () => {
    await open();
    choose();
    const fetch = door('/islands/d/bbbbbbbbbbbbbbbb.js');
    const importModule = vi.fn(async () => run(compiled.after.browserCode, 'test/view-after.js'));
    await morphStory(window, { surface: 'raw', fetch, importModule });
    expect(importModule).toHaveBeenCalledOnce();
    responds();
  });

  it('a page holding more view state than a request carries asks at its defaults, and still draws the version', async () => {
    await open();
    const remove = registerCommentState(document, 'notes:draft', { get: () => 'x'.repeat(10_000), set: () => {} });
    try {
      const fetch = door('/islands/d/aaaaaaaaaaaaaaaa.js');
      await morphStory(window, { surface: 'raw', fetch, importModule: vi.fn() });
      expect(new URL(String(fetch.mock.calls[0]![0]), 'http://test').searchParams.has(STORY_VIEW_PARAM)).toBe(false);
      expect($('lede').textContent).toBe('After');
    } finally { remove(); }
  });
});
