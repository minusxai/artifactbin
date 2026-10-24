/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { render, renderHook } from '@/solid/__tests__/helpers';
import { Drawer } from '../Drawer';
import { FloatingPanel } from '../FloatingPanel';
import { Popover } from '../Popover';
import { createAnchoredAppearance } from '../theme';

const noop = () => {};
afterEach(() => { document.documentElement.removeAttribute('data-theme'); vi.restoreAllMocks(); });

for (const kind of ['drawer', 'floating', 'popover'] as const) {
  it(`keeps an open ${kind} in sync with the root and preserves its local override`, async () => {
    const observing = vi.spyOn(MutationObserver.prototype, 'observe');
    const disconnecting = vi.spyOn(MutationObserver.prototype, 'disconnect');
    document.documentElement.setAttribute('data-theme', 'dark');
    let context!: HTMLDivElement;
    const result = render(() => <div ref={context}>
      {kind === 'drawer' ? <Drawer label="Panel" onClose={noop}>Content</Drawer> :
        kind === 'floating' ? <FloatingPanel label="Panel" position={{ left: 0, top: 0 }}>Content</FloatingPanel> :
        <Popover open onOpenChange={noop} label="Panel" trigger={(attrs) => <button {...attrs}>Open</button>}>Content</Popover>}
    </div>);
    const surface = document.querySelector('[aria-label="Panel"]')!;
    const palette = () => surface.closest('[data-app-appearance]')?.getAttribute('data-app-appearance');
    expect(palette()).toBe('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    await waitFor(() => expect(palette()).not.toBe('dark'));
    document.documentElement.setAttribute('data-theme', 'dark');
    await waitFor(() => expect(palette()).toBe('dark'));
    context.setAttribute('data-app-appearance', 'light');
    await waitFor(() => expect(palette()).toBe('light'));
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-theme', 'dark');
    await waitFor(() => expect(palette()).toBe('light'));
    context.setAttribute('data-app-appearance', 'dark');
    await waitFor(() => expect(palette()).toBe('dark'));
    const observers = new Set(observing.mock.instances);
    result.unmount();
    for (const observer of observers) expect(disconnecting.mock.instances).toContain(observer);
  });
}

it('follows the nearest shadow ancestor and returns to the host override when it is removed', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.setAttribute('data-app-appearance', 'light');
  const shadow = host.attachShadow({ mode: 'open' });
  const local = shadow.appendChild(document.createElement('div'));
  local.setAttribute('data-app-appearance', 'dark');
  const anchor = local.appendChild(document.createElement('button'));
  const hook = renderHook(() => createAnchoredAppearance(() => anchor));
  try {
    expect(hook.result()).toBe('dark');
    host.setAttribute('data-app-appearance', 'dark');
    local.setAttribute('data-app-appearance', 'light');
    await waitFor(() => expect(hook.result()).toBe('light'));
    local.removeAttribute('data-app-appearance');
    await waitFor(() => expect(hook.result()).toBe('dark'));
    hook.cleanup();
    host.setAttribute('data-app-appearance', 'light');
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(hook.result()).toBe('dark');
  } finally { hook.cleanup(); host.remove(); }
});
