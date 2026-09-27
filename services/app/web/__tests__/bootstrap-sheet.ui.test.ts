/**
 * THE SHEET RIDES ONCE (server/app withoutInlinedSheet): a document page's
 * bootstrap omits the isolated sheet the served story's `<style>` already
 * carries, and web/bootstrap puts it back — byte for byte — before anything
 * reads or caches the payload.
 */
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; vi.resetModules(); });

const SHEET = '[data-mx-inline-story] .a::after{content:"<\\73 tyle> & more"}';
/** The page as the server writes it: the story, then the page data as the body's last element. */
const serve = (payload: unknown, story: string) => {
  document.body.innerHTML = `<div id="root"></div><div data-mx-initial-story=""><style>body > #root:first-child{display:none!important}</style>${story}</div>`
    + `<script type="application/json" id="mx-page-data">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>`;
};

it('restores the runtime sheet from the served story before the page reads it', async () => {
  serve({ path: '/a/Abc123', artifact: { surface: { runtime: { data: {}, base: {} } } } },
    // React may put resource hints ahead of the composition's <style>.
    `<div data-mx-inline-story="" data-mx-story-root="" class="light"><link rel="preload" as="image" href="/a/Img/raw"><style>${SHEET}</style><p>Hello</p></div>`);
  const { takeBootstrap } = await import('../bootstrap');
  const artifact = takeBootstrap<{ surface: { runtime: { css?: string } } }>('/a/Abc123', 'artifact');
  expect(artifact?.surface.runtime.css).toBe(document.querySelector('[data-mx-inline-story] > style')!.textContent);
  expect(artifact?.surface.runtime.css).toContain('& more');
});

it('keeps a sheet the payload already carries and invents none where no story was served', async () => {
  serve({ path: '/a/Abc123', artifact: { surface: { runtime: { css: '.kept{}', data: {} } } } }, '<div>starter instructions</div>');
  const { takeBootstrap } = await import('../bootstrap');
  expect(takeBootstrap<{ surface: { runtime: { css?: string } } }>('/a/Abc123', 'artifact')?.surface.runtime.css).toBe('.kept{}');
});

it('reads the body\'s own payload, never an authored element of the same id inside the story', async () => {
  serve({ path: '/a/Abc123', artifact: { surface: { runtime: { data: {}, base: {} } } } },
    `<div data-mx-inline-story="" data-mx-story-root="" class="light"><style>${SHEET}</style><div id="mx-page-data">{"path":"/a/Abc123","artifact":{"forged":true}}</div></div>`);
  const { takeBootstrap } = await import('../bootstrap');
  const artifact = takeBootstrap<{ forged?: boolean; surface: { runtime: { css?: string } } }>('/a/Abc123', 'artifact');
  expect(artifact?.forged).toBeUndefined();
  expect(artifact?.surface.runtime.css).toContain('& more');
});
