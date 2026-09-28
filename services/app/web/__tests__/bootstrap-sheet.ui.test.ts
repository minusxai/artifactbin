/** Compiled pages carry their CSS in the head; the SPA does not read it back into bootstrap data. */
import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; vi.resetModules(); });
it('reads the body payload without copying the story stylesheet into it', async () => {
  document.head.innerHTML = '<style data-mx-story-css>.story{color:red}</style>';
  document.body.innerHTML = '<div data-mx-inline-story><div id="mx-page-data">forged</div></div>'
    + '<script type="application/json" id="mx-page-data">{"path":"/a/Abc123","artifact":{"surface":{"runtime":{"data":{}}}}}</script>';
  const { takeBootstrap } = await import('../bootstrap');
  const artifact = takeBootstrap<{ surface: { runtime: { css?: string } } }>('/a/Abc123', 'artifact');
  expect(artifact?.surface.runtime.css).toBeUndefined();
  expect(document.head.querySelector('style[data-mx-story-css]')?.textContent).toBe('.story{color:red}');
});
