import { describe, expect, it } from 'vitest';
import { parseJsx } from '../parse';
import { validateJsx } from '../validate';
import { STORY_HTML_TAGS, STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';

function errors(source: string) {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return validateJsx(parsed.nodes, { components: STORY_UI_COMPONENT_NAME_LIST, allowedHtmlTags: STORY_HTML_TAGS, stylePolicy: 'no-inline-style' });
}

describe('Mermaid source contract', () => {
  it('accepts editable static source for a first-class diagram', () => {
    expect(errors('<Mermaid title="Shift flow" code={"flowchart TD\\n A[Draft] --> B[Saved]"} />')).toEqual([]);
  });
  it.each(['', 'x'.repeat(20_001), '%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\nA-->B', '---\nconfig: {}\n---\nflowchart TD\nA-->B'])(
    'rejects empty, oversized or author-configured source', (code) => {
      expect(errors(`<Mermaid code={${JSON.stringify(code)}} />`).some(e => /Mermaid/.test(e.message))).toBe(true);
    },
  );
  it('rejects non-string source', () => {
    expect(errors('<Mermaid code={42} />').some(e => /Mermaid/.test(e.message))).toBe(true);
  });
});
