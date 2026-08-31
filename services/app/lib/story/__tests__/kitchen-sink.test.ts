/**
 * Kitchen-sink drift gate: the doc must instantiate EVERY registry component
 * (plus the three data embeds) and pass the full story publish gate. If a
 * component is added to the registry without a kitchen-sink appearance, this
 * fails — same enforcement pattern as registry-names.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { kitchenSinkMarkup } from '../kitchen-sink';
import { parseJsx, validateJsx } from '@/lib/jsx';
import { splitHelmet, validateHelmet } from '@/lib/story/helmet';
import { collectRefNameUses, validateDataflow } from '@/lib/story/dataflow';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_UI_COMPONENT_NAME_LIST, STORY_HTML_TAGS } from '@/lib/story-ui/component-names';

const SRC = kitchenSinkMarkup({ dataset: 'ksdataset01', recipe: 'ksrecipe01', image: 'ksimage01' });

describe('kitchen-sink doc', () => {
  it('parses and passes the full story publish gate', () => {
    expect(parseJsx(SRC).ok).toBe(true);
    // The publish gate's shape: the Helmet by its own grammar, the BODY by lib/jsx (jsx-tier).
    const parsed = parseJsx(SRC);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(validateHelmet(parsed.nodes)).toEqual([]);
    const split = splitHelmet(parsed.nodes);
    expect(validateJsx(split.body, { components: JSX_STORY_COMPONENT_NAMES, allowedHtmlTags: STORY_HTML_TAGS, stylePolicy: 'no-inline-style' })).toEqual([]);
    expect(validateDataflow({ values: split.content.values, queries: split.content.queries }, collectRefNameUses(split.body))).toEqual([]);
  });

  it('instantiates every registry component (drift gate)', () => {
    const missing = STORY_UI_COMPONENT_NAME_LIST.filter(
      (name) => !new RegExp(`<${name}[\\s/>]`).test(SRC),
    );
    expect(missing).toEqual([]);
  });

  it('instantiates the data embeds, a bound control, and all ref kinds', () => {
    for (const embed of ['Question', 'Number', 'Query', 'Value']) {
      expect(SRC).toMatch(new RegExp(`<${embed}[\\s/>]`));
    }
    expect(SRC).toContain('value="$region"');
    expect(SRC).toContain('ref_ksdataset01');
    expect(SRC).toContain('ref:ksrecipe01');
    expect(SRC).toContain('ref:ksimage01');
  });
});
