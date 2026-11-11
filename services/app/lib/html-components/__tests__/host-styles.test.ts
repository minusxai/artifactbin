// @vitest-environment jsdom
/**
 * A host page under a strict `style-src` (no 'unsafe-inline') opts out of injected <style> elements with
 * `<meta name="af-styles" content="adopted">`: every component it imports registers its rules as a constructed
 * sheet on document.adoptedStyleSheets, once per component, and no style element is created. A nonce meta puts
 * the host's nonce on the <style> instead; with neither, pages keep exactly the element they always had.
 */
import {JSDOM} from 'jsdom';
import {beforeAll, expect, it} from 'vitest';
import {registerComponent} from '../register-component';

const selectors = (sheets: readonly CSSStyleSheet[]) =>
  sheets.flatMap(sheet => [...sheet.cssRules]).map(rule => (rule as CSSStyleRule).selectorText ?? '').join(' ');

/** jsdom constructs sheets but has no document.adoptedStyleSheets: stand in for the browser's accessor. */
const adoptedOf = new WeakMap<Document, CSSStyleSheet[]>();
beforeAll(async () => {
  Object.defineProperty(Document.prototype, 'adoptedStyleSheets', {
    configurable: true,
    get(this: Document) { return adoptedOf.get(this) ?? []; },
    set(this: Document, sheets: CSSStyleSheet[]) { adoptedOf.set(this, [...sheets]); },
  });
  const own = new CSSStyleSheet();
  own.replaceSync('body{margin:0}');
  document.adoptedStyleSheets = [own];
  const meta = document.createElement('meta');
  meta.name = 'af-styles'; meta.content = 'adopted';
  document.head.append(meta);
  await import('../button');
  await import('../tabs');
});

it('a host page that imports two components gets their rules as adopted sheets and no <style>', async () => {
  expect(document.querySelectorAll('style')).toHaveLength(0);
  // The host's own sheet stays first; one sheet per component follows it.
  expect(document.adoptedStyleSheets).toHaveLength(3);
  expect(selectors(document.adoptedStyleSheets.slice(0, 1))).toBe('body');
  const css = selectors(document.adoptedStyleSheets);
  expect(css).toContain('af-button');
  expect(css).toContain('af-tabs-trigger');
  // Re-registering (another chunk's copy of the module) adopts nothing twice.
  const {buttonComponent} = await import('../button');
  registerComponent(buttonComponent);
  expect(document.adoptedStyleSheets).toHaveLength(3);
  const button = document.createElement('af-button');
  document.body.append(button);
  expect(customElements.get('af-button')).toBeDefined();
  expect(document.querySelectorAll('style')).toHaveLength(0);
});

it('puts a host nonce on the <style>, and falls back to it where sheets cannot be constructed', async () => {
  const {tabsComponent} = await import('../tabs');
  const nonced = new JSDOM('<meta name="af-style-nonce" content="n0nce">').window;
  registerComponent({...tabsComponent, elements: {}}, nonced.customElements, nonced.document);
  const style = nonced.document.querySelector('style[data-af-tabs-styles]');
  expect(style?.getAttribute('nonce')).toBe('n0nce');

  // This window has no adoptedStyleSheets (as an older browser): the adopted opt-in falls back to the nonce <style>.
  const old = new JSDOM('<meta name="af-styles" content="adopted"><meta name="af-style-nonce" content="n1">').window;
  expect('adoptedStyleSheets' in old.document).toBe(false);
  registerComponent({...tabsComponent, elements: {}}, old.customElements, old.document);
  expect(old.document.querySelectorAll('style[data-af-tabs-styles]')).toHaveLength(1);
  expect(old.document.querySelector('style')?.getAttribute('nonce')).toBe('n1');
});

it('a page without either meta keeps one plain <style> per component, as published pages always had', async () => {
  const {tabsComponent} = await import('../tabs');
  const page = new JSDOM('<title>page</title>').window;
  registerComponent({...tabsComponent, elements: {}}, page.customElements, page.document);
  registerComponent({...tabsComponent, elements: {}}, page.customElements, page.document);
  const styles = page.document.querySelectorAll('style');
  expect(styles).toHaveLength(1);
  expect(styles[0]!.hasAttribute('data-af-tabs-styles')).toBe(true);
  expect(styles[0]!.hasAttribute('nonce')).toBe(false);
  expect(styles[0]!.textContent).toBe(tabsComponent.styles);
  expect(styles[0]!.parentElement).toBe(page.document.head);
});
