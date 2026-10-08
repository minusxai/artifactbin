/** The app page's data is the body's own element: an element of the same id inside the page is never read. */
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; vi.resetModules(); });
it('reads the body payload, once per address, and never an element inside the page', async () => {
  document.body.innerHTML = '<div data-mx-framed><div id="mx-page-data">forged</div></div>'
    + '<script type="application/json" id="mx-page-data">{"path":"/a/Abc123","artifact":{"surface":{"id":"Abc123","runtime":{"data":{}}}}}</script>';
  const { takeBootstrap } = await import('@/solid/lib/bootstrap');
  const artifact = takeBootstrap<{ surface: { id: string; runtime: { css?: string } } }>('/a/Abc123', 'artifact');
  expect(artifact?.surface.id).toBe('Abc123');
  expect(artifact?.surface.runtime.css).toBeUndefined();
  expect(takeBootstrap('/a/Abc123', 'artifact')).toBeNull();
});
