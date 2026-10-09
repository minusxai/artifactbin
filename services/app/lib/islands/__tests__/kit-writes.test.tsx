/* @jsxImportSource solid-js */
/**
 * THE KIT'S WRITE CONTROLS, LIVE (lib/islands/kit/basic Button, kit/controls Segmented) — what today's
 * runtime adapters do (lib/story-runtime/StoryRuntimeApp ButtonAdapter, RuntimeRowAction,
 * SegmentedAdapter), on the island's store:
 *
 * - `<Button run>` follows the store's write check: a guest's `$_me` write is disabled and says
 *   "Unavailable while signed out." (as its accessible description and in an interaction tooltip), an allowed one
 *   performs the `<Mutation>` with `set=` applied first and `args=` resolved at the click, busy while
 *   it is in flight, and a refusal is shown in a `role="alert"`.
 * - In a `<For>` row the button writes with the row, and refuses without a durable row key; its write in
 *   flight and its refusal are the DOCUMENT's (today's RuntimeRowAction over lib/story-runtime/row-actions),
 *   so a row re-rendered meanwhile is still busy and a second click writes nothing.
 * - The runtime's context answers the write checks (`mutationUnavailable`, `mutating`) reactively.
 * - `<DialogContent run>` is a form performing the mutation on submit: disabled with the reason for a
 *   write the reader may not make, closed once saved, open with the refusal shown when it fails.
 * - `<Segmented>` offers "All" only when the bound Value's declared default is null.
 */
import { describe, expect, it, vi } from 'vitest';
import { createComputed, createRoot, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { createIslandRuntime, declarationsOf } from '../rt';
import { createDataflowStore, type QueryTransport } from '@/lib/story-runtime/store';
import { compiledOf } from '@/test/helpers/compiled';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { Button, stableRowKey } from '../kit/basic';
import { ACCESS_PENDING } from '../kit/store-read';
import { validRowKey } from '@/lib/story-ui/repeat-identity';
import { Segmented } from '../kit/controls';
import { Select, loadSelectPopup } from '../kit/select';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../kit/dialog';
import type { IslandContext } from '../contract';
import type { DataflowStore } from '@/lib/story-runtime/store';
import type { CompiledDataflow } from '@/lib/dataflow/compiled-dataflow';
import type { Scalar } from '@/lib/dataflow/dataflow';

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

/** The fake store's write checks as the runtime's context answers them: re-read on every store change. */
const islandOn = (store: DataflowStore, viewer: IslandContext['viewer'] = () => null, values: Record<string, string> = {}): IslandContext => {
  const [tick, setTick] = createSignal(0, { equals: false });
  store.subscribe(() => setTick(0));
  return {
    ...fakeIsland(values), store: () => store, ...declarationsOf(() => store), viewer,
    mutationUnavailable: (name) => { tick(); return store.mutationUnavailable(name); },
    mutating: (name) => { tick(); return store.mutating().has(name); },
  };
};
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
    expect(host.textContent).toBe('Vote as me');
    const trigger = button.closest('[data-slot="tooltip-trigger"]') as HTMLElement;
    expect(trigger?.tabIndex).toBe(0);
    trigger.focus();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Unavailable while signed out.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    trigger.click();
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('Unavailable while signed out.');
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

describe('a row action\'s state is the document\'s, not the button\'s (today\'s RuntimeRowAction)', () => {
  const row = { id: 7, title: 'x' };
  const scope = { owner: 'f', key: 7, durable: true, ids: [] };
  const RowButton = () => <Button run="$done" args={{ id: { ref: '_row.id' } }} row={row} rowScope={scope} data-mx-ast="0.1">Done</Button>;

  it('a row re-rendered while its write is in flight is still busy, and a second click does not write again', async () => {
    const s = fakeStore({ access: { done: null } });
    const island = islandOn(s.store);
    const first = mount(island, () => <RowButton />);
    first.host.querySelector('button')!.click();
    expect(s.store.mutate).toHaveBeenCalledTimes(1);
    first.dispose();

    // The row came back (reordered, filtered, scrolled into a virtual window): a new button, the same row action.
    const again = mount(island, () => <RowButton />);
    const button = again.host.querySelector('button')!;
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    button.click();
    expect(s.store.mutate).toHaveBeenCalledTimes(1);

    s.settle(new Error('the dataset is closed'));
    await flush();
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.disabled).toBe(false);
    expect(again.host.querySelector('[role="alert"]')?.textContent).toBe('the dataset is closed');
    again.dispose();

    // …and the refusal outlives the button too, until the next attempt clears it.
    const third = mount(island, () => <RowButton />);
    expect(third.host.querySelector('[role="alert"]')?.textContent).toBe('the dataset is closed');
    third.host.querySelector('button')!.click();
    expect(third.host.querySelector('[role="alert"]')).toBeNull();
    expect(s.store.mutate).toHaveBeenCalledTimes(2);
    third.dispose();
  });

  it('a `set=`-only button in a row is no row action: it sets the row\'s values, with or without a durable key (the booking day pick)', () => {
    const s = fakeStore();
    const { host, dispose } = mount(islandOn(s.store), () => <>
      <Button set={{ day: { ref: '_row.day' } }} row={{ day: '2026-10-01' }} rowScope={{ owner: 'days', key: '2026-10-01', durable: true, ids: [] }}>Thu 1</Button>
      <Button set={{ day: { ref: '_row.day' } }} row={{ day: '2026-10-02' }} rowScope={{ owner: 'days', key: 1, durable: false, ids: [] }}>Fri 2</Button>
    </>);
    const [thu, fri] = [...host.querySelectorAll('button')];
    expect(host.querySelector('[role="alert"]')).toBeNull();
    thu!.click();
    expect(s.store.setValues).toHaveBeenLastCalledWith({ day: '2026-10-01' });
    fri!.click();
    expect(s.store.setValues).toHaveBeenLastCalledWith({ day: '2026-10-02' });
    expect(s.store.mutate).not.toHaveBeenCalled();
    dispose();
  });

  it('each row, and each document, has its own', () => {
    const s = fakeStore({ access: { done: null } });
    const island = islandOn(s.store);
    const other = { ...row, id: 8 };
    const { host, dispose } = mount(island, () => <>
      <RowButton />
      <Button run="$done" row={other} rowScope={{ ...scope, key: 8 }} data-mx-ast="0.1">Done</Button>
    </>);
    const [a, b] = [...host.querySelectorAll('button')];
    a!.click();
    expect(a!.getAttribute('aria-busy')).toBe('true');
    expect(b!.hasAttribute('aria-busy')).toBe(false);
    dispose();

    const elsewhere = mount(islandOn(s.store), () => <RowButton />);
    expect(elsewhere.host.querySelector('button')!.hasAttribute('aria-busy'), 'another document\'s row actions are its own').toBe(false);
    elsewhere.dispose();
  });
});

describe('the island context\'s write checks (rt createIslandRuntime)', () => {
  it('mutationUnavailable and mutating follow the store: pending until the check answers, busy while a write is in flight', async () => {
    const flow = await compiledOf('<Import name="votes" src="ref:Votes0001" /><Mutation name="add">{`insert into votes.rows (choice) values (\'x\')`}</Mutation>', { Votes0001: [{ name: 'choice', type: 'string' }] });
    let release!: () => void;
    const transport: QueryTransport = {
      run: async () => ({ tables: {}, errors: {}, mutationAccess: { add: null } }),
      page: async () => ({ rows: [], columns: [] }),
      mutate: () => new Promise((resolve) => { release = () => resolve({ dataset: 'Votes0001' }); }),
    };
    const runtime = createIslandRuntime({ dataflow: { flow } }, (input) => createDataflowStore(input, { transport, debounceMs: 0 }));
    const seen: Array<[string | null, boolean]> = [];
    const stop = createRoot((dispose) => {
      createComputed(() => seen.push([runtime.context.mutationUnavailable('add'), runtime.context.mutating('add')]));
      return dispose;
    });
    expect(seen.at(-1)).toEqual([ACCESS_PENDING, false]);
    runtime.store!.start();
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([null, false]));
    const write = runtime.context.mutate({ mutation: 'add', args: {} });
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([null, true]));
    release();
    await write;
    await vi.waitFor(() => expect(seen.at(-1)).toEqual([null, false]));
    stop();
    runtime.dispose();
  });

  it('with no store, and while the server renders, a write check is pending', () => {
    const runtime = createIslandRuntime({}, () => { throw new Error('no data'); });
    expect(runtime.context.mutationUnavailable('add')).toBe(ACCESS_PENDING);
    expect(runtime.context.mutating('add')).toBe(false);
  });
});

describe('restated constants', () => {
  it('the kit\'s row-key rule is the interpreter\'s', () => {
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
  it('dismisses a picker with Escape before dismissing its parent dialog', async () => {
    await loadSelectPopup();
    const { host, dispose } = mount(fakeIsland({ person: '' }), () => <Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Feedback"><Select label="Person" value="$person" options={['Ada']} /><DialogClose>Cancel</DialogClose></DialogContent></Dialog>);
    document.body.append(host);
    const dialog = host.querySelector('dialog')!;
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = () => dialog.removeAttribute('open');
    try {
      host.querySelector<HTMLButtonElement>('button')!.click();
      const trigger = dialog.querySelector<HTMLButtonElement>('[aria-label="Person"]')!;
      trigger.click(); await Promise.resolve();
      const search = dialog.querySelector<HTMLInputElement>('[role="searchbox"]')!;
      expect(search).toBeTruthy();
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(dialog.open).toBe(true);
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(dialog.open).toBe(false);
    } finally { dispose(); host.remove(); }
  });

  const open = (host: HTMLElement) => { (host.querySelector('button') as HTMLButtonElement).click(); return document.querySelector('dialog') as HTMLDialogElement; };

  it('closes a native modal in its trusted portal before moving it home', () => {
    const portal = document.createElement('div'); document.body.append(portal);
    const island = { ...islandOn(fakeStore().store), trustedPortal: () => portal };
    const { host, dispose } = mount(island, () => <Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Sprint"><DialogClose aria-label="Cancel sprint">Cancel</DialogClose></DialogContent></Dialog>);
    const dialog = host.querySelector('dialog')!;
    let closedInPortal = false;
    dialog.showModal = () => dialog.setAttribute('open', '');
    dialog.close = () => { closedInPortal = portal.contains(dialog); dialog.removeAttribute('open'); };
    host.querySelector('button')!.click();
    expect(portal.contains(dialog)).toBe(true);
    // A served close button may be adopted before its own Solid listener attaches.
    const close = portal.querySelector<HTMLButtonElement>('[aria-label="Cancel sprint"]')!;
    const servedClose = close.cloneNode(true) as HTMLButtonElement;
    close.replaceWith(servedClose);
    servedClose.click();
    expect(closedInPortal).toBe(true);
    expect(host.contains(dialog)).toBe(true);
    dispose(); portal.remove();
  });

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

  it('replaces a failed first permission check with a clear refusal and recovers on a later answer', async () => {
    const flow = await compiledOf('<Import name="votes" src="ref:Votes0001" /><Mutation name="add">{`insert into votes.rows (choice) values (\'x\')`}</Mutation>', { Votes0001: [{ name: 'choice', type: 'string' }] });
    const run = vi.fn().mockRejectedValue(new Error('offline'));
    const mutate = vi.fn();
    const store = createDataflowStore({ flow }, { transport: { run, mutate, page: vi.fn() } });
    const { host, dispose } = mount(islandOn(store), () => <Dialog><DialogTrigger>Open</DialogTrigger><DialogContent aria-label="Add" run="$add"><button type="submit">Save</button></DialogContent></Dialog>);
    try {
      const dialog = open(host);
      expect(dialog.querySelector('[role="status"]')?.textContent).toBe(ACCESS_PENDING);
      store.start(); await flush();
      expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Access check failed. Reload.');
      expect(dialog.querySelector('fieldset')!.disabled).toBe(true);
      expect(mutate).not.toHaveBeenCalled();
      run.mockResolvedValue({ tables: {}, errors: {}, mutationAccess: { add: null } });
      store.invalidateDatasets(['Votes0001']); await flush();
      expect(dialog.querySelector('[role="status"]')).toBeNull();
      expect(dialog.querySelector('fieldset')!.disabled).toBe(false);
    } finally { store.dispose(); dispose(); }
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
