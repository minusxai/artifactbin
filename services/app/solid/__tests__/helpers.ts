/**
 * The two @solidjs/testing-library calls the P3 ports use, over solid-js/web and @testing-library/dom
 * (both already installed), so the probe adds no package: `render` mounts into a container on
 * document.body and returns its bound queries; `renderHook` runs a primitive inside a reactive root.
 * Every mount is disposed after each test, as the library's auto-cleanup would.
 */
import { afterEach } from 'vitest';
import { createRoot, type JSX } from 'solid-js';
import { render as mount } from 'solid-js/web';
import { getQueriesForElement } from '@testing-library/dom';
import '@testing-library/jest-dom/vitest';

export { fireEvent } from '@testing-library/dom';

const mounted = new Set<() => void>();
afterEach(() => { for (const dispose of mounted) dispose(); mounted.clear(); });

export function render(ui: () => JSX.Element) {
  const container = document.body.appendChild(document.createElement('div'));
  const dispose = mount(ui, container);
  const unmount = () => { if (!mounted.delete(unmount)) return; dispose(); container.remove(); };
  mounted.add(unmount);
  return { container, unmount, ...getQueriesForElement(container) };
}

export function renderHook<T>(primitive: () => T) {
  return createRoot((dispose) => {
    const cleanup = () => { if (mounted.delete(cleanup)) dispose(); };
    mounted.add(cleanup);
    return { result: primitive(), cleanup };
  });
}
