/* @jsxImportSource solid-js */
/**
 * THE KIT'S WRITE CONTROLS, LIVE (lib/islands/kit/basic Button, kit/controls Segmented) — what today's
 * runtime adapters do (lib/story-runtime/StoryRuntimeApp ButtonAdapter, RuntimeRowAction,
 * SegmentedAdapter), on the island's store:
 *
 * - `<Button run>` follows the store's write check: a guest's `$_me` write is disabled and says
 *   "Unavailable while signed out." (as its accessible description and beside it), an allowed one
 *   performs the `<Mutation>` with `set=` applied first and `args=` resolved at the click, busy while
 *   it is in flight, and a refusal is shown in a `role="alert"`.
 * - In a `<For>` row the button writes with the row, and refuses without a durable row key.
 * - `<DialogContent run>` is a form performing the mutation on submit: disabled with the reason for a
 *   write the reader may not make, closed once saved, open with the refusal shown when it fails.
 * - `<Segmented>` offers "All" only when the bound Value's declared default is null.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Button, stableRowKey } from '../kit/basic';
import { ACCESS_PENDING } from '../kit/store-read';
import { ACCESS_PENDING as STORE_ACCESS_PENDING } from '@/lib/story-runtime/store';
import { validRowKey } from '@/lib/story/repeat-identity';
import { Segmented } from '../kit/controls';
import { Dialog, DialogContent, DialogTrigger } from '../kit/dialog';
import type { IslandContext } from '../contract';
import type { DataflowStore } from '@/lib/story-runtime/store';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { Scalar } from '@/lib/story/dataflow';

const flow = (values: Array<{ name: string; default: Scalar }> = []): CompiledDataflow => ({
  imports: [], queries: [], mutations: [],
  values: values.map((v) => ({ name: v.name, kind: 'scalar', type: 'string', default: v.default })),
});

/** A store double with exactly the surface the write controls read. */
function fakeStore(opts: { access?: Record<string, string | null>; values?: Record<string, Scalar>; flow?: CompiledDataflow } = {}) {
  const listeners = new Set<() => void>();
  let access = { ...(opts.access ?? {}) };
  const values: Record<string, Scalar> = { ...(opts.values ?? {}) };
  const busy = new Set<string>();
  let settle: ((error?: Error) => void) | null = null;
  const store = {
    flow: opts.flow ?? flow(),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    mutationUnavailable: (name: string) => (Object.hasOwn(access, name) ? access[name]! : 'Checking edit access…'),
    mutating: () => busy,
    getValue: (name: string) => values[name] ?? null,
    setValues: vi.fn((next: Record<string, Scalar>) => { Object.assign(values, next); }),
    mutate: vi.fn((name: string) => {
      busy.add(name); emit();
      return new Promise<void>((resolve, reject) => { settle = (error) => { busy.delete(name); emit(); if (error) reject(error); else resolve(); }; });
    }),
  };
  const emit = () => { for (const fn of [...listeners]) fn(); };
  return {
    store: store as unknown as DataflowStore & { mutate: ReturnType<typeof vi.fn>; setValues: ReturnType<typeof vi.fn> },
    answer(next: Record<string, string | null>) { access = { ...access, ...next }; emit(); },
    settle(error?: Error) { settle?.(error); },
  };
}

const islandOn = (store: DataflowStore, viewer: IslandContext['viewer'] = () => null, values: Record<string, string> = {}): IslandContext => ({ ...fakeIsland(values), store: () => store, viewer });
const mount = (island: IslandContext, view: () => import('solid-js').JSX.Element) => {
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => <IslandProvider value={island}>{view()}</IslandProvider>, host);
  return { host, dispose: () => { dispose(); host.remove(); } };
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('<Button run> on the island store', () => {
  it('a guest\'s identity write is disabled, described and labelled exactly as today, and a click does nothing', () => {
    const s = fakeStore({ access: { mine: 'sign_in_required' } });
    const { host, dispose } = mount(islandOn(s.store), () => <Button run="$mine" id="b">Vote as me</Button>);
    const button = host.querySelector('button')!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-description')).toBe('Unavailable while signed out.');
    expect(button.nextElementSibling?.outerHTML).toBe('<span class="text-xs text-muted-foreground">Unavailable while signed out.</span>');
    button.click();
    expect(s.store.mutate).not.toHaveBeenCalled();
    dispose();
  });

  it('says "Checking edit access…" until the store\'s write check answers, then enables', () => {
    const s = fakeStore();
    const { host, dispose } = mount(islandOn(s.store), () => <Button run="$vote">Vote</Button>);
    const button = host.querySelector('button')!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-description')).toBe('Checking edit access…');
    s.answer({ vote: null });
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-description')).toBe(false);
    expect(button.nextElementSibling).toBeNull();
    dispose();
  });

  it('a signed-in click sets `set=` first, then performs the mutation with `args=` resolved at the click ($_me.id from the viewer), busy while in flight', async () => {
    const s = fakeStore({ access: { vote: null }, values: { choice: 'ramen' } });
    const viewer = () => ({ id: 'u1', handle: 'ada', name: 'Ada', image: null }) as never;
    const { host, dispose } = mount(islandOn(s.store, viewer), () => <Button run="$vote" set={{ choice: { literal: 'tacos' } }} args={{ who: { ref: '_me.id' }, choice: { ref: 'choice' } }}>Vote</Button>);
    const button = host.querySelector('button')!;
    button.click();
    expect(s.store.setValues).toHaveBeenCalledWith({ choice: 'tacos' });
    expect(s.store.mutate).toHaveBeenCalledWith('vote', { who: 'u1', choice: 'tacos' });
    expect(s.store.setValues.mock.invocationCallOrder[0]).toBeLessThan(s.store.mutate.mock.invocationCallOrder[0]!);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    s.settle();
    await flush();
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.disabled).toBe(false);
    dispose();
  });

  it('a refused write is shown beside the button, and cleared by the next attempt', async () => {
    const s = fakeStore({ access: { vote: null } });
    const { host, dispose } = mount(islandOn(s.store), () => <Button run="$vote">Vote</Button>);
    host.querySelector('button')!.click();
    s.settle(new Error('the dataset is closed'));
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('the dataset is closed');
    host.querySelector('button')!.click();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    dispose();
  });

  it('a `set=`-only button changes page values and never writes', () => {
    const s = fakeStore();
    const { host, dispose } = mount(islandOn(s.store), () => <Button set={{ choice: { literal: 'tacos' } }}>Tacos</Button>);
    const button = host.querySelector('button')!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(s.store.setValues).toHaveBeenCalledWith({ choice: 'tacos' });
    expect(s.store.mutate).not.toHaveBeenCalled();
    dispose();
  });

  it('in a keyed row it writes with the row; without a durable key it refuses as today', () => {
    const s = fakeStore({ access: { done: null } });
    const row = { id: 7, title: 'x', tags: ['a'] };
    const { host, dispose } = mount(islandOn(s.store), () => <>
      <Button run="$done" args={{ id: { ref: '_row.id' } }} row={row} rowScope={{ owner: 'f', key: 7, durable: true, ids: [] }}>Done</Button>
      <Button run="$done" row={row} rowScope={{ owner: 'f', key: 0, durable: false, ids: [] }}>Done</Button>
    </>);
    host.querySelector('button')!.click();
    expect(s.store.mutate).toHaveBeenCalledWith('done', { id: 7 }, { id: 7, title: 'x' });
    expect(host.querySelector('span[role="alert"]')?.textContent).toBe('Row actions require a stable row key');
    dispose();
  });
});

describe('restated constants', () => {
  it('the kit\'s pending check and row-key rule are the store\'s and the interpreter\'s', () => {
    expect(ACCESS_PENDING).toBe(STORE_ACCESS_PENDING);
    for (const key of ['a', '', 'x'.repeat(256), 'x'.repeat(257), 'a\u0001', 0, 7.5, NaN, Infinity, null, undefined, true, {}]) expect(stableRowKey(key)).toBe(validRowKey(key));
  });
});

describe('<Segmented> options', () => {
  it('offers "All" only when the bound Value declares a null default, as today\'s live control does', () => {
    const s = fakeStore({ flow: flow([{ name: 'choice', default: 'ramen' }, { name: 'pick', default: null }]) });
    const { host, dispose } = mount(islandOn(s.store, () => null, { choice: 'ramen' }), () => <>
      <Segmented label="Choice" value="$choice" options={['ramen', 'tacos']} />
      <Segmented label="Pick" value="$pick" options={['a', 'b']} />
    </>);
    const [choice, pick] = [...host.querySelectorAll('[role="group"]')].map((g) => [...g.querySelectorAll('button')].map((b) => b.textContent));
    expect(choice).toEqual(['ramen', 'tacos']);
    expect(pick).toEqual(['All', 'a', 'b']);
    dispose();
  });
});

describe('<DialogContent run> on the island store', () => {
  const open = (host: HTMLElement) => { (host.querySelector('button') as HTMLButtonElement).click(); return document.querySelector('dialog') as HTMLDialogElement; };

  it('a guest\'s identity write: the form\'s fields are disabled and it says why, as today\'s dialog does', () => {
    const s = fakeStore({ access: { mine: 'sign_in_required' } });
    const { host, dispose } = mount(islandOn(s.store), () => <Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Add" run="$mine" stacked><input name="t" /><button type="submit">Save</button></DialogContent></Dialog>);
    const dialog = open(host);
    const form = dialog.querySelector('form')!;
    expect(form.className).toBe('contents');
    expect(form.querySelector('fieldset')!.disabled).toBe(true);
    expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Unavailable while signed out.');
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(s.store.mutate).not.toHaveBeenCalled();
    dispose();
  });

  it('an allowed write submits with `args=`, closes once saved, and stays open with the refusal when it fails', async () => {
    const s = fakeStore({ access: { add: null }, values: { title: 'Milk' } });
    const { host, dispose } = mount(islandOn(s.store), () => <Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Add" run="$add" args={{ t: { ref: 'title' } }} stacked={false}><button type="submit">Save</button></DialogContent></Dialog>);
    const dialog = open(host);
    const form = dialog.querySelector('form')!;
    expect(form.hasAttribute('class')).toBe(false);
    expect(form.querySelector('fieldset')!.disabled).toBe(false);
    expect(dialog.querySelector('[role="status"]')).toBeNull();
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(s.store.mutate).toHaveBeenCalledWith('add', { t: 'Milk' });
    expect(form.querySelector('fieldset')!.disabled, 'busy while in flight').toBe(true);
    s.settle(new Error('row_changed'));
    await flush();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('row_changed');
    expect(dialog.open || dialog.hasAttribute('open')).toBe(true);
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    s.settle();
    await flush();
    expect(dialog.open || dialog.hasAttribute('open')).toBe(false);
    dispose();
  });
});
