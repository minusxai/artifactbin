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
import { parseJsx } from '@/lib/jsx';
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
