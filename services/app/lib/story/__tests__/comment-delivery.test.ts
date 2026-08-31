/**
 * THE THIRD DELIVERY: comments without the runtime.
 *
 * Commenting needs the FRAME — only the document can see a Selection at an
 * opaque origin, measure a node or find an anchor — but it does not need the
 * EDITOR. It was getting one anyway: a commenter's frame asked for `?edit=1`,
 * which made the document "hydrate", which shipped the whole hydration runtime
 * so a page of prose could draw a tint. Measured at the time of writing:
 * 383.7 KB against 13.3 KB.
 *
 * So there are now three shapes a served document can take, and the rules
 * between them are what this file pins:
 *
 *   - a plain reader        → neither script, and no island
 *   - a commenter           → the COMMENT entry and the island
 *   - anything that hydrates→ the RUNTIME (which already reaches annotate)
 *
 * NEVER BOTH is the load-bearing one: two annotate sessions on one document
 * would fight over the same nodes. And the island is required either way —
 * `describeSelection` classifies against the SOURCE and answers null without
 * it, so a comment layer with no island would report no selection at all and
 * commenting would silently do nothing.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument, type StoryDocumentInput } from '@/lib/story/document';

const RUNTIME = '/story/entry-TESTHASH.js';
const COMMENT = '/story/comment-TESTHASH.js';

/** Pure prose — nothing to hydrate, so delivery is decided entirely by the flags. */
const PROSE = '<div><h1>Hello</h1><p>Ordinary prose.</p></div>';
/** A component: this document hydrates whatever anyone asks for. */
const WITH_COMPONENT = '<div><h1>Hello</h1><Card><CardContent>inside</CardContent></Card></div>';

const doc = (over: Partial<StoryDocumentInput> = {}): Promise<string> =>
  buildStoryDocument({
    source: PROSE,
    compiledCss: null, theme: null, colorMode: null, refData: {},
    title: 'T', runtimeSrc: RUNTIME, commentSrc: COMMENT, lazyChunks: [],
    ...over,
  });

const hasRuntime = (html: string) => html.includes(`src="${RUNTIME}"`);
const hasComment = (html: string) => html.includes(`src="${COMMENT}"`);
const hasIsland = (html: string) => html.includes('application/json" id="mx-story-data"');

describe('a plain reader', () => {
  it('gets neither script and no island — prose hydrates nothing', async () => {
    const html = await doc();
    expect(hasRuntime(html)).toBe(false);
    expect(hasComment(html)).toBe(false);
    expect(hasIsland(html)).toBe(false);
  });
});

describe('a commenter on a document of prose', () => {
  it('gets the COMMENT entry, not the runtime', async () => {
    const html = await doc({ commenting: true });
    expect(hasComment(html), 'the 13 KB frame half').toBe(true);
    expect(hasRuntime(html), 'and not the 384 KB runtime').toBe(false);
  });

  it('still gets the ISLAND — without it describeSelection answers null and nothing can be commented on', async () => {
    const html = await doc({ commenting: true });
    expect(hasIsland(html)).toBe(true);
    const island = JSON.parse(html.slice(html.indexOf('id="mx-story-data">') + 19).split('</script>')[0]) as { nodes: unknown[] };
    expect(Array.isArray(island.nodes) && island.nodes.length > 0, 'the parsed body, for classification').toBe(true);
  });
});

describe('an editor', () => {
  it('gets the RUNTIME — editing happens in the frame and prose ships none', async () => {
    const html = await doc({ editable: true });
    expect(hasRuntime(html)).toBe(true);
    expect(hasComment(html)).toBe(false);
  });

  it('gets the runtime and NOT the comment layer even when asked for both', async () => {
    const html = await doc({ editable: true, commenting: true });
    expect(hasRuntime(html)).toBe(true);
    expect(hasComment(html), 'never both: two annotate sessions would fight over the same nodes').toBe(false);
  });
});

describe('a document that hydrates anyway', () => {
  it('gets the runtime, not the comment layer — annotate is already inside it', async () => {
    const html = await doc({ source: WITH_COMPONENT, commenting: true });
    expect(hasRuntime(html)).toBe(true);
    expect(hasComment(html)).toBe(false);
  });
});

describe('a runtime built before the comment entry existed', () => {
  it('falls back to the RUNTIME, which is what a commenter got before — never to silence', async () => {
    const html = await doc({ commenting: true, commentSrc: null });
    expect(hasRuntime(html), 'the old, heavy, working delivery').toBe(true);
    expect(hasComment(html)).toBe(false);
    expect(hasIsland(html), 'and still the island it needs').toBe(true);
  });
});
