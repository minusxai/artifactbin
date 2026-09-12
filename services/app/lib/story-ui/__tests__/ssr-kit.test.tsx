/**
 * Smoke check for the unified markup pipeline: the SSR
 * seam the unified /raw route stands on. Every kit component must survive
 * React server rendering — `renderToStaticMarkup` over the interpreter's
 * element tree — because the sandboxed view iframe has no parent React tree to
 * fall back on. A component that throws here cannot ship in the unified
 * document until fixed or excluded.
 *
 * Subject: the kitchen-sink document (the registry drift gate guarantees it
 * instantiates every kit component). Embeds (`Question`/`Number`/`Param`) are
 * NOT in `STORY_UI_COMPONENTS` — unknown component tags render nothing — and
 * get their own server-render story (the data island + runtime hydration);
 * this test pins the kit.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { IconGlyphProvider } from '@/components/kit/icon';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { FALLBACK_ICON_KEY } from '@/lib/story-ui/icon-contract';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { kitchenSinkMarkup } from '@/lib/story/kitchen-sink';

const MARKUP = kitchenSinkMarkup({ dataset: 'aaaaaa', recipe: 'bbbbbb', image: 'cccccc', pdf: 'dddddd' });

describe('kit SSR (renderToStaticMarkup over the interpreter)', () => {
  it('server-renders the kitchen-sink document without throwing', () => {
    const parsed = parseJsx(MARKUP);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const html = renderToStaticMarkup(
      <>{renderStoryNodes(parsed.nodes, { components: STORY_UI_COMPONENTS })}</>,
    );

    // Spot markers across component families: prose, Radix state (tabs render
    // the default pane), tables, slides (the discovery stamp), video card.
    expect(html).toContain('The Kitchen Sink');
    expect(html).toContain('First pane content.');
    expect(html).toContain('Accordion section A');
    expect(html).toContain('Grid-hosted chart');
    expect(html).toContain('data-mx-slide');
    expect(html).toContain('data-slot="video-link"');
    expect(html).toContain('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
    expect(html).toContain('Definition term');
  });
});

/**
 * EVERY COMPONENT IS CLICKABLE: the interpreter stamps `data-mx-ast` on every
 * element as a PROP, but a component that does not carry it into the DOM is a
 * component the edit session cannot select — a click inside it walks up to
 * whatever ancestor did carry the stamp, and the element itself can never be
 * named, commented on, or deleted from the toolbar (lib/story/selection-
 * toolbar). This walks the kitchen-sink document (the drift gate guarantees
 * it instantiates every registry component) and asserts each component node's
 * own path is present in the rendered DOM.
 *
 * The exceptions are content that legitimately has no box until interaction —
 * Radix mounts them on open — plus the live embeds, which are not in the bare
 * registry at all (their selectability is pinned by the in-place-editor suite
 * and the viz-editor gate).
 */
/** Content with no box until someone opens it — Radix mounts these on demand. */
const UNMOUNTED_UNTIL_OPEN = new Set([
  'TabsContent',        // only the default pane mounts
  'AccordionContent',   // collapsed items render nothing
  'CollapsibleContent', // same
  'TooltipContent', 'TooltipProvider', 'Tooltip', 'TooltipTrigger', // portal/slot wrappers
  'PopoverContent', 'PopoverHeader', 'PopoverTitle', 'PopoverDescription', 'PopoverAnchor',
  // The Radix Popover ROOT renders no element of its own — only context. Its
  // trigger and content are the boxes, and both carry their own stamps.
  'Popover',
  // Radix renders the <img> only once it LOADS; in the browser it then
  // carries the stamp (Radix forwards props), but SSR has no load event.
  'AvatarImage',
]);
/** Not in the bare registry: the live embeds render through the runtime. */
const RUNTIME_ONLY = new Set(['Question', 'Number', 'Value', 'Query', 'Mutation']);

/**
 * <Icon> draws only from resolved glyph data (lib/story/icon-glyphs) and
 * spreads its props onto the svg — so give the render the fallback glyph the
 * server ships with any icon-bearing document, and the stamps must appear.
 */
// Populate the gallery's query-backed For so its template participates in the
// stamp contract; an empty query correctly renders no template nodes.
const TABLES = { regions: { rows: [{ region: 'EU' }] } };

const GLYPHS = { [FALLBACK_ICON_KEY]: { cls: 'lucide-badge-question-mark', inner: '<path d="" />' } };

function componentNodes(nodes: JsxNode[], base = ''): Array<{ tag: string; path: string }> {
  const out: Array<{ tag: string; path: string }> = [];
  nodes.forEach((node, i) => {
    const path = base ? `${base}.${i}` : String(i);
    if (node.type !== 'element') return;
    if (node.tag === 'Helmet') return; // document-level declarations, never rendered
    if (node.isComponent) out.push({ tag: node.tag, path });
    out.push(...componentNodes(node.children, path));
  });
  return out;
}

describe('every registry component carries its stamp into the DOM', () => {
  it('renders each component node with its own data-mx-ast', () => {
    const parsed = parseJsx(MARKUP);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const html = renderToStaticMarkup(
      <IconGlyphProvider value={GLYPHS}>{renderStoryNodes(parsed.nodes, { components: STORY_UI_COMPONENTS, tables: TABLES })}</IconGlyphProvider>,
    );
    const stamped = new Set([...html.matchAll(/data-mx-ast="([^"]+)"/g)].map((m) => m[1]));

    const missing = componentNodes(parsed.nodes)
      .filter(({ tag }) => !UNMOUNTED_UNTIL_OPEN.has(tag) && !RUNTIME_ONLY.has(tag))
      .filter(({ path }) => !stamped.has(path));
    expect(missing, `components whose stamp never reached the DOM — unselectable: ${missing.map((m) => m.tag).join(', ')}`)
      .toEqual([]);
  });
});
