import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.resetModules(); });
it('uses original frame RPC with explicit HTML anchors and never exposes credentials', async () => {
  vi.stubGlobal('__AF_RUNTIME_CONFIG__', { pageId: 'p1', revision: '3', backends: ['orders'], appOrigin: 'https://platform.example' });
  const runtime = await import('../browser-client');
  const events: Array<{ kind: string; [key: string]: unknown }> = [];
  const bridge = runtime.startFrameBridge({ win: window, post: (event) => events.push(event), attach: { kind: 'attach', id: 'p1', nodes: [], editId: '3', source: null } });
  document.body.innerHTML = '<p data-af-id="n1">Hello</p>';
  bridge.receive({ kind: 'send', command: { type: 'mx:selection-actions', edit: false, annotate: true } });
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  document.querySelector('p')!.dispatchEvent(menu);
  const action = events.find((item) => item.kind === 'event')?.event as { selection: { anchor: unknown }; nonce: string };
  expect(action.selection.anchor).toEqual({ kind: 'html-node', v: 1, revision: '3', nodeId: 'n1', quote: '' });
  expect(action.nonce).toBe((events[0] as { nonce?: string }).nonce);
  expect(menu.defaultPrevented).toBe(true);
  bridge.receive({ kind: 'restored', call: 9 });
  expect(events).toContainEqual({ kind: 'restored', call: 9, ok: true });
  bridge.dispose();
});
