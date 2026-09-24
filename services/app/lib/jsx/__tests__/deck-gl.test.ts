import { describe, expect, it } from 'vitest';
import { validateJsx } from '../validate';
import { STORY_HTML_TAGS, STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

function errors(source: string) {
  const parsed = parseJsxOrThrow(source);
  return validateJsx(parsed.nodes, { components: STORY_UI_COMPONENT_NAME_LIST, allowedHtmlTags: STORY_HTML_TAGS, stylePolicy: 'no-inline-style' });
}

describe('<DeckGL> publish contract', () => {
  it('accepts a map in deck.gl\'s JSON dialect', () => {
    expect(errors('<DeckGL data="$points" basemap="none" layers={[{"@@type":"ScatterplotLayer","getPosition":"@@=[lng, lat]"}]} />')).toEqual([]);
  });
  it('refuses a layer URL, naming the component', () => {
    const found = errors('<DeckGL data="$points" layers={[{"@@type":"GeoJsonLayer","data":"https://evil.example/x.json"}]} />');
    expect(found.some(e => e.tag === 'DeckGL' && /never a URL/.test(e.message))).toBe(true);
  });
  it('refuses layers that are missing or not static', () => {
    expect(errors('<DeckGL data="$points" />').some(e => /layers/.test(e.message))).toBe(true);
  });
});
