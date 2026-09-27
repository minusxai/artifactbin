/**
 * The /a/:id reader HYDRATES the server's render instead of drawing it again.
 *
 * One composition on both sides (lib/story-runtime/inline-composition) is what
 * makes that match by construction: the server renders it to a string
 * (ssr-entry renderInlineStory), the browser hydrates the same tree with the
 * same props, and React keeps every server node. Any hydration error or
 * warning — structural (#418) or attribute-only (generated ids, styles), which
 * React 19 leaves WRONG in the page — fails here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import type { StoryIslandData } from '../contract';
import { InlineStoryComposition, inlineStoryCss } from '../inline-composition';
import { renderInlineStory } from '../ssr-entry';

const KIT = `<article>
  <h1>Hydrate me</h1>
  <Tabs defaultValue="one"><TabsList><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList>
    <TabsContent value="one"><p>first</p></TabsContent><TabsContent value="two"><p>second</p></TabsContent></Tabs>
  <Accordion type="single" collapsible><AccordionItem value="a"><AccordionTrigger>Open</AccordionTrigger><AccordionContent>inside</AccordionContent></AccordionItem></Accordion>
  <Card><CardHeader><CardTitle>Card</CardTitle></CardHeader><CardContent>body</CardContent></Card>
</article>`;

const data = (source: string): StoryIslandData => ({ nodes: parseJsxOrThrow(source).nodes, refData: {}, colorMode: 'light', template: 'editorial' } as StoryIslandData);
const CSS = { baseCss: 'body{margin:0}', compiledCss: '.x{color:red}', authorCss: '.kpi{letter-spacing:-0.02em}' };

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('the inline reader hydrates the server render', () => {
  it('hydrates a kit document with no error, no warning, and keeps the server nodes', async () => {
    const d = data(KIT);
    const css = inlineStoryCss(CSS);
    const host = document.createElement('div');
    host.innerHTML = renderInlineStory(d, css);
    document.body.appendChild(host);
    const serverNodes = [...host.querySelectorAll('*')];
    const errors: unknown[] = [];
    vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(args); });
    await act(async () => {
      hydrateRoot(host, <InlineStoryComposition data={d} css={css} />, {
        onRecoverableError: (e) => errors.push(e), onCaughtError: (e) => errors.push(e), onUncaughtError: (e) => errors.push(e),
      });
    });
    expect(errors).toEqual([]);
    // Every element the server drew is still the element in the page.
    expect(serverNodes.every((n) => host.contains(n))).toBe(true);
    // Generated ids agree: every aria-controls names an element that exists.
    for (const el of host.querySelectorAll('[aria-controls]')) {
      expect(document.getElementById(el.getAttribute('aria-controls')!), el.outerHTML).not.toBeNull();
    }
  });
});

describe('one CSS assembly for both sides', () => {
  it('can never close its <style> from inside author CSS', () => {
    const css = inlineStoryCss({ ...CSS, authorCss: '.a{} </style><script>alert(1)</script>' });
    expect(css.toLowerCase()).not.toContain('</style');
  });

  it('skips missing parts without leaving blank separators, identically every time', () => {
    const a = inlineStoryCss({ baseCss: 'b{}', compiledCss: null, authorCss: null });
    expect(a).toBe(inlineStoryCss({ baseCss: 'b{}', compiledCss: '', authorCss: '' }));
  });
});
