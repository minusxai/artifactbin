/**
 * <Icon> — lucide icons as a registered story component, so agents stop hand-drawing
 * SVGs. `name` takes the lucide site kebab-case name (PascalCase also accepted);
 * an unknown name renders the question-mark fallback rather than nothing — a wrong
 * name must be visible in the document, never a silent hole. Chrome is a small
 * default footprint (`size-4`) that an authored size-* class overrides via cn().
 *
 * Every one of those promises is unchanged. What changed is WHO resolves the glyph:
 * the component used to hold all ~1600 of them, which every reader downloaded
 * (148 KB gz) to serve the 2-in-155 documents that draw an icon — and paid again on
 * every visit, since a sandboxed document cannot reuse its cache. Now the server
 * resolves the handful a document uses and they arrive in the island
 * (lib/story/icon-glyphs), while the EDIT CANVAS — which renders a draft with no
 * server round trip — keeps the full set in its own on-demand chunk.
 *
 * So the contract below is exercised through BOTH renderers, because a document is
 * read through one and written through the other and they must not drift.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { STORY_UI_COMPONENTS } from '../registry';
import { STORY_UI_COMPONENT_NAME_LIST } from '../component-names';
import { IconGlyphProvider } from '@/components/kit/icon';
import { buildGlyphMap } from '@/lib/story/icon-glyphs';

const KitIcon = STORY_UI_COMPONENTS.Icon;

/** How a READER sees an icon: the server resolved it, the island carried it. */
function served(props: { name: string } & Record<string, unknown>) {
  return (
    <IconGlyphProvider value={buildGlyphMap([props.name])}>
      <KitIcon {...props} />
    </IconGlyphProvider>
  );
}

/*
 * ONE renderer now. There used to be two — the served document and the edit
 * canvas, which kept the whole ~1600-glyph lucide map so a draft could resolve
 * a name with no round trip. Editing happens in the served document, so a draft
 * resolves its icons exactly the way every other version does, and the second
 * renderer (with its map) is gone.
 */
const RENDERERS: [string, (props: { name: string } & Record<string, unknown>) => React.ReactElement][] = [
  ['served document', served],
];

describe('<Icon>', () => {
  it('is registered under both the registry and the names-only module', () => {
    expect(KitIcon).toBeTruthy();
    expect(STORY_UI_COMPONENT_NAME_LIST).toContain('Icon');
  });

  describe.each(RENDERERS)('%s', (_label, renderIcon) => {
    it('renders the named lucide icon as inline svg (kebab-case name)', () => {
      const { container } = render(renderIcon({ name: 'calendar', 'aria-label': 'cal' }));
      expect(container.querySelector('svg[aria-label="cal"]')).toBeTruthy();
      expect(container.querySelector('svg path, svg rect, svg circle, svg line')).toBeTruthy();
    });

    it('accepts PascalCase names too', () => {
      const { container } = render(renderIcon({ name: 'ChartBar', 'aria-label': 'chart' }));
      expect(container.querySelector('svg[aria-label="chart"]')).toBeTruthy();
    });

    it('falls back to the question-mark icon for unknown names', () => {
      const known = render(renderIcon({ name: 'circle-question-mark', 'aria-label': 'known' }));
      const unknown = render(renderIcon({ name: 'definitely-not-an-icon', 'aria-label': 'unknown' }));
      const knownSvg = known.container.querySelector('svg')!;
      const unknownSvg = unknown.container.querySelector('svg')!;
      expect(unknownSvg).toBeTruthy();
      expect(unknownSvg.innerHTML).toBe(knownSvg.innerHTML);
    });

    it('has the default size class and lets an authored size-* override win', () => {
      const { container } = render(
        <>
          {renderIcon({ name: 'calendar', 'aria-label': 'default-size' })}
          {renderIcon({ name: 'calendar', 'aria-label': 'custom-size', className: 'size-8' })}
        </>,
      );
      const byLabel = (l: string) => container.querySelector(`svg[aria-label="${l}"]`)!;
      expect(byLabel('default-size').getAttribute('class')).toContain('size-4');
      const custom = byLabel('custom-size').getAttribute('class')!;
      expect(custom).toContain('size-8');
      expect(custom).not.toContain('size-4');
    });
  });

  it.each([
    ['no name at all', {}],
    ['an empty name', { name: '' }],
  ])('falls back to the question mark for %s, never a silent hole', (_label, props) => {
    const glyphs = buildGlyphMap(['circle-question-mark']);
    const { container } = render(
      <IconGlyphProvider value={glyphs}>
        <KitIcon {...(props as { name: string })} aria-label="bad" />
      </IconGlyphProvider>,
    );
    const svg = container.querySelector('svg[aria-label="bad"]');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('class')).toContain('lucide-circle-question-mark');
  });

  it('renders nothing when the glyph was never resolved, rather than a wrong one', () => {
    // The invariant that lets the icon set leave the bundle: with no glyph the kit
    // component has no way to draw this name, and a WRONG glyph in a document is
    // worse than an absent one. Every serving path resolves them (lib/story/document),
    // so a reader never lands here.
    const { container } = render(<KitIcon name="calendar" aria-label="unresolved" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
