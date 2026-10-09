/* @jsxImportSource solid-js */
/**
 * COMMENTABLE STATE IN THE PAGE: a kit element's view state under its node id, a script's named signal under its
 * mount, and a restore that reaches a screen mounted after it (lib/islands/comment-state, lib/story-runtime/comment-state).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Show, createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../kit/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../kit/disclosure';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { MountScope, commentSignal, commentStateKey } from '../comment-state';
import { exposeCommentValues, mountComponents, scriptCreateSignal } from '../page-runtime';
import { bindPage } from '@/lib/story-runtime/page-bindings';
import { createDataflowStore } from '@/lib/story-runtime/store';
import type { CompiledDataflow } from '@/lib/dataflow/compiled-dataflow';
import { clearPendingCommentState } from '@/lib/story-runtime/comment-state';
import { captureCommentState, restoreCommentState } from '@/lib/story-runtime/comment-state-io';

// CI runs this file in a jsdom other files have rendered kit controls into, so only the keys this file owns are compared.
const OWN = /^(\$$|t\d:|c\d:|app1:|aBcD:|eFgH:|screen$)/;
const captured = () => Object.fromEntries(Object.entries(captureCommentState(document)?.state ?? {}).filter(([key]) => OWN.test(key)));
const registry = () => ({ capture: () => ({ v: 2 as const, state: captured() }), restore: (saved: Parameters<typeof restoreCommentState>[1]) => restoreCommentState(document, saved) });
afterEach(() => { document.body.innerHTML = ''; clearPendingCommentState(document); });

const tabs = (id: string | undefined, controlled?: string) => (
  <Tabs id={id} defaultValue="one" value={controlled}><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList>
    <TabsContent value="one"><p>first</p></TabsContent><TabsContent value="two"><p>second</p></TabsContent></Tabs>
);

describe('kit view state', () => {
  it('saves the chosen tab under the element\'s node id, restores it, and seeds a tab mounted after the restore', () => {
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <IslandProvider value={fakeIsland()}>{tabs('t1')}{tabs(undefined)}{tabs('t3', 'one')}</IslandProvider>, host);
    expect(registry().capture()).toEqual({ v: 2, state: { 't1:value': 'one' } });
    host.querySelectorAll<HTMLElement>('[role="tab"]')[1]!.click();
    expect(registry().capture()).toEqual({ v: 2, state: { 't1:value': 'two' } });
    registry().restore({ v: 2, state: { 't1:value': 'one', 't9:value': 'two', 'gone:open': true } });
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('One');
    const late = document.createElement('div'); document.body.append(late);
    const disposeLate = render(() => <IslandProvider value={fakeIsland()}>{tabs('t9')}</IslandProvider>, late);
    expect(late.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Two');
    expect(registry().capture()).toEqual({ v: 2, state: { 't1:value': 'one', 't9:value': 'two' } });
    disposeLate(); dispose();
    expect(captured()).toEqual({});
  });
  it('saves a collapsible\'s open state under its node id and leaves a bound one to its Value', () => {
    const host = document.createElement('div'); document.body.append(host);
    const dispose = render(() => <IslandProvider value={fakeIsland()}>
      <Collapsible id="c1"><CollapsibleTrigger>More</CollapsibleTrigger><CollapsibleContent>details</CollapsibleContent></Collapsible>
      <Collapsible id="c2" open={true}><CollapsibleTrigger>Bound</CollapsibleTrigger><CollapsibleContent>bound</CollapsibleContent></Collapsible>
    </IslandProvider>, host);
    expect(registry().capture()).toEqual({ v: 2, state: { 'c1:open': false } });
    host.querySelector<HTMLElement>('button')!.click();
    expect(registry().capture()).toEqual({ v: 2, state: { 'c1:open': true } });
    dispose();
  });
});

describe('the declared Values', () => {
  it('register as one group of what the link carries, and restore through the store in one write', async () => {
    const flow: CompiledDataflow = { imports: [], queries: [], mutations: [], values: [
      { name: 'region', kind: 'scalar', type: 'string', default: 'west' },
      { name: 'secret', kind: 'scalar', type: 'string', default: 'x', url: false },
    ] };
    const store = createDataflowStore({ flow, results: { tables: {}, errors: {} } }, { transport: { run: async () => ({ tables: {}, errors: {} }), page: async () => ({ rows: [], columns: [] }) } });
    const stop = exposeCommentValues(document, store);
    expect(registry().capture()).toEqual({ v: 2, state: { $: { region: 'west' } } });
    store.setValue('region', 'east');
    expect(registry().capture()).toEqual({ v: 2, state: { $: { region: 'east' } } });
    registry().restore({ v: 2, state: { $: { region: 'north', secret: 'leak', gone: 1 } } });
    expect(store.getState().values).toMatchObject({ region: 'north', secret: 'x' });
    stop(); store.dispose();
    expect(captured()).toEqual({});
  });
});

describe('a script\'s named signals', () => {
  it('key by the mount they render in, stay bare at module level, and are dropped with the module', () => {
    const registrations = new Set<() => void>();
    const createSignal = scriptCreateSignal(registrations);
    const [screen, setScreen] = createSignal('plans', { name: 'screen' }) as [() => string, (v: string) => void];
    const [, setScratch] = createSignal(0) as [() => number, (v: number) => void];
    expect(registrations.size).toBe(1);
    document.body.innerHTML = '<div data-mx-mount="Player" id="aBcD"></div><div data-mx-mount="Player" id="eFgH"></div>';
    const Player = () => {
      const [time, setTime] = createSignal(0, { name: 'time' }) as [() => number, (v: number) => void];
      return <button onClick={() => setTime(time() + 10)}>{time()}</button>;
    };
    const unmount = mountComponents(document.body, { Player }, bindPage(null));
    expect(registry().capture()).toEqual({ v: 2, state: { screen: 'plans', 'aBcD:time': 0, 'eFgH:time': 0 } });
    document.querySelectorAll<HTMLElement>('button')[1]!.click(); setScreen('checkout'); setScratch(5);
    expect(registry().capture()).toEqual({ v: 2, state: { screen: 'checkout', 'aBcD:time': 0, 'eFgH:time': 10 } });
    registry().restore({ v: 2, state: { screen: 'plans', 'eFgH:time': 42 } });
    expect([screen(), document.querySelectorAll('button')[1]!.textContent]).toEqual(['plans', '42']);
    unmount();
    expect(registry().capture()).toEqual({ v: 2, state: { screen: 'plans' } });
    for (const remove of registrations) remove();
    expect(captured()).toEqual({});
  });
  it('restores a screen mounted by the restore itself, and warns on a duplicate key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    document.body.innerHTML = '<div data-mx-mount="App" id="app1"></div>';
    const App = () => {
      const [screen, setScreen] = commentSignal(commentStateKey('screen'), 'plans');
      const Checkout = () => { const [step] = commentSignal(commentStateKey('step'), 1); return <p>step {step()}</p>; };
      return <div><button onClick={() => setScreen('checkout')}>go</button><Show when={screen() === 'checkout'}><Checkout /></Show></div>;
    };
    const unmount = mountComponents(document.body, { App }, bindPage(null));
    expect(registry().capture()).toEqual({ v: 2, state: { 'app1:screen': 'plans' } });
    registry().restore({ v: 2, state: { 'app1:screen': 'checkout', 'app1:step': 3 } });
    expect(document.querySelector('p')?.textContent).toBe('step 3');
    createRoot((dispose) => { commentSignal('app1:screen', 'dup'); expect(warn).toHaveBeenCalledWith(expect.stringContaining('app1:screen')); dispose(); });
    unmount(); warn.mockRestore();
    expect(MountScope.defaultValue).toBeNull();
  });
});
