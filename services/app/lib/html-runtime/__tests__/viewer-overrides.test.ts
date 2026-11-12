import { describe, expect, it, vi } from 'vitest';
import type { HtmlJsonObject } from '@artifactbin/contracts';
import { createPageState, type PageState, type PageStateOptions } from '../page-state';
import { encodeState } from '../apollo/state-url';
// The one GraphQL import: old pages read and write the same document through `gql`.
import { createClient, gql } from '../apollo/graphql-compat';
import { createHtmlCommentViewSession, withHtmlCommentView } from '../../html-bridge/comment-view-session';

/** One viewer's browser storage (one localStorage), shared by every load of the page in it. */
function viewer(seed?: Record<string, string>) {
  const items = new Map<string, string>(Object.entries(seed ?? {}));
  const tabs = new Set<(key: string | null) => void>();
  let queue = Promise.resolve();
  const open = (defaults: HtmlJsonObject, extra: Partial<PageStateOptions> = {}): PageState => createPageState({
    pageId: 'p', initial: defaults, hash: '', backends: [], owner: {},
    storage: { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } },
    onStorage: (listener) => { tabs.add(listener); return () => { tabs.delete(listener); }; },
    lock: (_name, work) => { const next = queue.then(work); queue = next.then(() => {}, () => {}); return next; },
    ...extra,
  });
  /** What this browser keeps, under its own key: only the viewer's overrides, never a full copy. */
  const stored = () => { const raw = items.get('af:viewer:v2:p'); return raw ? JSON.parse(raw) as { $af: string; version: string | null; revision: string | null; overrides: HtmlJsonObject } : null; };
  /** The `storage` event every other tab receives after a write. */
  const deliver = () => tabs.forEach((listener) => listener('af:viewer:v2:p'));
  return { open, stored, items, deliver };
}
const query = (keys: readonly string[]) => { const source = `{${keys.join(' ')}}`; return gql(Object.assign([source], { raw: [source] }) as unknown as TemplateStringsArray); };
/** The two ways a page changes and reads this document: `@afbin/state` and `gql` (old pages). */
const paths = {
  state: {
    write: (page: PageState, values: HtmlJsonObject) => page.state.setState(values),
    read: async (page: PageState, keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, page.state.getState()[key] ?? null])),
  },
  gql: {
    write: async (page: PageState, values: HtmlJsonObject) => { await createClient({ backends: [], state: page.port }).updateQuery({ query: query(Object.keys(values)) }, () => values); },
    read: async (page: PageState, keys: readonly string[]) => (await createClient({ backends: [], state: page.port }).query({ query: query(keys) })).data,
  },
} as const;

describe.each(Object.keys(paths) as (keyof typeof paths)[])('saved viewer state over the page defaults, through %s', (name) => {
  const { write, read } = paths[name];

  it('keeps Alice\'s choice and gives her a new default; Bob, who never saved, gets the new defaults', async () => {
    const alice = viewer(), bob = viewer();
    await write(alice.open({ tab: 'summary' }), { tab: 'details' });
    expect(alice.stored()).toEqual({ $af: 'overrides', version: null, revision: null, overrides: { tab: 'details' } });
    const republished = { tab: 'summary', theme: 'dark' };
    expect(await read(alice.open(republished), ['tab', 'theme'])).toEqual({ tab: 'details', theme: 'dark' });
    expect(await read(bob.open(republished), ['tab', 'theme'])).toEqual({ tab: 'summary', theme: 'dark' });
    expect(alice.open(republished).port.read()).toEqual({ tab: 'details', theme: 'dark' });
  });

  it('a changed default reaches a viewer for every key she never changed, or changed back', async () => {
    const alice = viewer();
    const page = alice.open({ tab: 'summary', theme: 'light', size: 's' });
    await write(page, { tab: 'details' });
    await write(page, { size: 'm' });
    await write(page, { size: 's' });
    expect(alice.stored()!.overrides).toEqual({ tab: 'details' });
    expect(await read(alice.open({ tab: 'summary', theme: 'dark', size: 'l' }), ['tab', 'theme', 'size'])).toEqual({ tab: 'details', theme: 'dark', size: 'l' });
  });

  it('drops an override whose JSON type no longer matches the default\'s; a null default takes any value', async () => {
    const alice = viewer();
    await write(alice.open({ page: 1, chosen: null, list: [] }), { page: 3, chosen: 'a', list: ['x'] });
    expect(await read(alice.open({ page: 1, chosen: null, list: [] }), ['page', 'chosen', 'list'])).toEqual({ page: 3, chosen: 'a', list: ['x'] });
    expect(await read(alice.open({ page: '1', chosen: null, list: {} }), ['page', 'chosen', 'list'])).toEqual({ page: '1', chosen: 'a', list: {} });
  });

  it('a new state version clears every stored override once', async () => {
    const alice = viewer();
    const v1 = { initial: { tab: 'summary' }, version: '1' };
    await write(alice.open(v1.initial, { version: v1.version }), { tab: 'details', note: 'mine' });
    expect(await read(alice.open(v1.initial, { version: '1' }), ['tab', 'note'])).toEqual({ tab: 'details', note: 'mine' });
    const v2 = alice.open({ tab: 'summary' }, { version: '2' });
    expect(await read(v2, ['tab', 'note'])).toEqual({ tab: 'summary', note: null });
    // Reading writes nothing: version 1's entry stays until version 2 first writes.
    expect(alice.stored()!.version).toBe('1');
    // Once: what she saves under version 2 stays.
    await write(v2, { tab: 'details' });
    expect(alice.stored()).toEqual({ $af: 'overrides', version: '2', revision: null, overrides: { tab: 'details' } });
    expect(await read(alice.open({ tab: 'summary' }, { version: '2' }), ['tab', 'note'])).toEqual({ tab: 'details', note: null });
  });

  it('keeps keys the page saved that have no default', async () => {
    const alice = viewer();
    await write(alice.open({ tab: 'summary' }), { note: 'remember me' });
    expect(alice.stored()!.overrides).toEqual({ note: 'remember me' });
    expect(await read(alice.open({ tab: 'overview' }), ['tab', 'note'])).toEqual({ tab: 'overview', note: 'remember me' });
  });

  it('merges one level deep: a saved nested object replaces the default object whole', async () => {
    const alice = viewer();
    await write(alice.open({ filters: { region: 'all', year: 2024 } }), { filters: { region: 'eu', year: 2024 } });
    expect(await read(alice.open({ filters: { region: 'all', year: 2025, sort: 'asc' } }), ['filters'])).toEqual({ filters: { region: 'eu', year: 2024 } });
  });
});

it('ignores the old full-document key and persists only current overrides', async () => {
  const legacy = JSON.stringify({ tab: 'details', note: 'old' });
  const alice = viewer({ 'af:viewer:p': legacy });
  const page = alice.open({ tab: 'summary', theme: 'light' });
  expect(page.state.getState()).toEqual({ tab: 'summary', theme: 'light' });
  expect(alice.stored()).toBeNull();
  await page.state.setState({ tab: 'details' });
  expect(alice.stored()).toEqual({ $af: 'overrides', version: null, revision: null, overrides: { tab: 'details' } });
  expect(alice.items.get('af:viewer:p')).toBe(legacy);
});

it('a legacy document is not carried over once the page declares a state version', async () => {
  const alice = viewer({ 'af:viewer:p': JSON.stringify({ tab: 'details' }) });
  const page = alice.open({ tab: 'summary' }, { version: '1' });
  expect(page.state.getState()).toEqual({ tab: 'summary' });
  await page.state.setState({ note: 'n' });
  expect(alice.stored()).toEqual({ $af: 'overrides', version: '1', revision: null, overrides: { note: 'n' } });
  expect(alice.items.get('af:viewer:p')).toBe('{"tab":"details"}');
});

it('an #af-state link seeds overrides over the current defaults, replacing what this viewer had saved', async () => {
  const alice = viewer();
  await alice.open({ tab: 'summary', theme: 'dark' }).state.setState({ theme: 'light', note: 'old' });
  const seeded = alice.open({ tab: 'summary', theme: 'dark' }, { hash: '#af-state=' + encodeState({ tab: 'details', theme: 'dark' }) });
  expect(seeded.state.getState()).toEqual({ tab: 'details', theme: 'dark' });
  // Persisted under the page lock, like any write.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(alice.stored()!.overrides).toEqual({ tab: 'details' });
});

it('comment views snapshot the merged document and a restore stores only overrides', async () => {
  const owner = {}, alice = viewer();
  const page = alice.open({ tab: 'summary', theme: 'dark' }, { owner, stateBlock: { getAttribute: () => null } });
  await page.state.setState({ tab: 'details' });
  const captured = withHtmlCommentView(owner, {}).viewState!;
  expect(captured).toMatchObject({ state: { $html: { fields: { tab: 'details', theme: 'dark' } } } });
  await page.state.setState({ tab: 'summary' });
  await createHtmlCommentViewSession(owner).receive({ openId: 'c', pins: [{ id: 'c', viewState: captured }] });
  expect(page.state.getState()).toEqual({ tab: 'details', theme: 'dark' });
  expect(alice.stored()!.overrides).toEqual({ tab: 'details' });
});

it('removing a key that has a default brings the default back', async () => {
  const alice = viewer();
  const page = alice.open({ tab: 'summary' });
  await page.state.setState({ note: 'x' });
  await page.state.setState({ note: 'y' }, true);
  expect(page.state.getState()).toEqual({ tab: 'summary', note: 'y' });
  expect(alice.stored()!.overrides).toEqual({ note: 'y' });
});

it('review: an already-open old version cannot reset the new version on every read', async () => {
  const alice = viewer();
  const old = alice.open({ count: 0 }, { version: '1' });
  await old.state.setState({ count: 1 });
  const next = alice.open({ count: 0 }, { version: '2' });
  await next.state.setState({ count: 7 });
  old.port.read(); // An ordinary storage notification also calls this.
  expect(next.port.read()).toEqual({ count: 7 });
});

it('review: canonical equality removes reordered objects and alternate number spellings', async () => {
  const alice = viewer();
  const page = alice.open({ obj: { a: 1, b: 2 }, n: 1e0, list: [{ a: 1, b: 2 }] });
  // Reads write nothing; canonical equality leaves no override for the defaults.
  expect(alice.stored()).toBeNull();
  await page.state.setState({ obj: { b: 3, a: 1 } });
  await page.state.setState({ obj: { b: 2, a: 1 } });
  expect(alice.stored()!.overrides).toEqual({});
});

it('review: corrupt current storage falls back to private memory and old state is ignored', async () => {
  const corrupt = viewer({ 'af:viewer:v2:p': '{broken' });
  const page = corrupt.open({ count: 0 });
  await page.state.setState({ count: 1 });
  expect(page.port.read()).toEqual({ count: 1 });
  expect(corrupt.items.get('af:viewer:v2:p')).toBe('{broken');
  const partial = viewer({ 'af:viewer:p': '{"count":3}' });
  expect(partial.open({ count: 0, theme: 'dark' }).port.read()).toEqual({ count: 0, theme: 'dark' });
});

describe('older page revisions are fenced off from a newer one\'s saved state', () => {
  it('review: v1 and v2 tabs open together, with storage notifications firing, lose nothing of v2\'s', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const alice = viewer();
    const old = alice.open({ count: 0 }, { version: '1', revision: '1' });
    await old.state.setState({ count: 1 });
    alice.deliver();
    const next = alice.open({ count: 0 }, { version: '2', revision: '2' });
    expect(next.state.getState()).toEqual({ count: 0 });
    await next.state.setState({ count: 7 });
    alice.deliver();
    // The old tab keeps reading (every notification does), and cannot write over the newer revision.
    old.port.read();
    expect(old.state.getState()).toEqual({ count: 0 });
    await old.state.setState({ count: 2 });
    expect(old.state.getState()).toEqual({ count: 0 });
    expect(errors).toHaveBeenCalled();
    await expect(createClient({ backends: [], state: old.port }).updateQuery({ query: query(['count']) }, () => ({ count: 3 }))).rejects.toThrow(/reload/i);
    alice.deliver();
    old.port.read();
    expect(next.port.read()).toEqual({ count: 7 });
    expect(alice.stored()).toEqual({ $af: 'overrides', version: '2', revision: '2', overrides: { count: 7 } });
    errors.mockRestore();
  });

  it('a newer revision with a new version resets the old overrides on its first write, never on a read', async () => {
    const alice = viewer();
    await alice.open({ tab: 'a' }, { version: '1', revision: '3' }).state.setState({ tab: 'b', note: 'v1' });
    const next = alice.open({ tab: 'a' }, { version: '2', revision: '4' });
    next.port.read();
    expect(alice.stored()).toMatchObject({ version: '1', revision: '3', overrides: { tab: 'b', note: 'v1' } });
    await next.state.setState({ tab: 'c' });
    expect(alice.stored()).toEqual({ $af: 'overrides', version: '2', revision: '4', overrides: { tab: 'c' } });
  });

  it('a newer revision of the same version carries the overrides forward, and the older tab becomes read-only', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const alice = viewer();
    const old = alice.open({ tab: 'a', theme: 'light' }, { revision: '1' });
    await old.state.setState({ tab: 'b' });
    const next = alice.open({ tab: 'a', theme: 'light' }, { revision: '2' });
    expect(next.state.getState()).toEqual({ tab: 'b', theme: 'light' });
    await next.state.setState({ theme: 'dark' });
    alice.deliver();
    expect(old.state.getState()).toEqual({ tab: 'b', theme: 'dark' });
    await old.state.setState({ tab: 'z' });
    expect(alice.stored()).toEqual({ $af: 'overrides', version: null, revision: '2', overrides: { tab: 'b', theme: 'dark' } });
    expect(old.state.getState()).toEqual({ tab: 'b', theme: 'dark' });
    errors.mockRestore();
  });
});
