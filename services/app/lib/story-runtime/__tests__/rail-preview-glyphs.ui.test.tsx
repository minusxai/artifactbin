/**
 * THE DECK RAIL IS A RENDER PATH, AND EVERY RENDER PATH OWES GLYPHS.
 *
 * `<Icon>` is resolved by the server: the renderer draws from a glyph map
 * carried beside the AST, so a path that renders slide nodes without it draws
 * NOTHING — the previews come out with the slide's text and a hole where the
 * icon goes. That is not hypothetical; it is how the rail shipped once, and it
 * survived because the gate asserted `innerText` on the thumb, which an <svg>
 * is invisible to (scripts/gate-deck-chrome.mjs).
 *
 * So the assertion is on the drawn GLYPH, in the RAIL specifically, and it
 * lives in vitest rather than a browser gate because that is what CI runs.
 */
import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/helpers/render-with-providers';

import { StoryRuntimeApp } from '../StoryRuntimeApp';
import { parseJsx } from '@/lib/jsx';
import { glyphsForNodes } from '@/lib/story/icon-glyphs';

const DECK = `<SlideDeck>
  <Slide title="Cover"><h1>The Cover Slide</h1><Icon name="chart-column" /></Slide>
  <Slide title="Close"><h1>The Closing Slide</h1></Slide>
</SlideDeck>`;

function renderDeck(source: string) {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  // Exactly what the served document does: resolve the glyphs the nodes name,
  // then hand them to the one composition both ends render.
  return renderWithProviders(
    <StoryRuntimeApp
      nodes={parsed.nodes}
      refData={{}}
      glyphs={glyphsForNodes(parsed.nodes)}
      colorMode="light"
    />,
  );
}

describe('the deck rail renders the slide’s icons, not a hole', () => {
  it('draws an svg glyph inside the rail preview', () => {
    const { container } = renderDeck(DECK);
    const thumb = container.querySelector('.mx-rail-thumb');
    expect(thumb, 'the rail rendered no preview at all').toBeTruthy();
    // The text was always there — it is the glyph that went missing, and
    // innerText cannot see one.
    expect(thumb!.textContent).toContain('The Cover Slide');
    expect(thumb!.querySelector('svg'), 'the rail preview drew no glyph').toBeTruthy();
  });

  it('draws the SAME glyph in the rail as in the document body', () => {
    const { container } = renderDeck(DECK);
    const inBody = container.querySelector('.mx-doc svg.lucide, .mx-doc svg');
    const inRail = container.querySelector('.mx-rail-thumb svg');
    expect(inBody, 'the document body drew no glyph').toBeTruthy();
    expect(inRail, 'the rail drew no glyph').toBeTruthy();
    // Same glyph data, drawn twice: a rail fed a different (or empty) map
    // renders the fallback or nothing, and this is what says which happened.
    expect(inRail!.innerHTML).toBe(inBody!.innerHTML);
  });

  it('a slide with no icon still previews its text (the guard is not vacuous)', () => {
    const { container } = renderDeck(DECK);
    const thumbs = container.querySelectorAll('.mx-rail-thumb');
    expect(thumbs.length).toBe(2);
    expect(thumbs[1].textContent).toContain('The Closing Slide');
    expect(thumbs[1].querySelector('svg')).toBeNull();
  });
});
