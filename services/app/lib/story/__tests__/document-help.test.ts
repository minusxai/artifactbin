/**
 * DISCOVER (cleanup/discover): a served artifact tells an agent how to edit it. An agent given a pasted link fetches
 * the document and finds, in <head>, a `<link rel="help">` to the docs index and a one-line `<meta name="artifactbin:agent">`
 * naming the docs and /tokens/new. Measured motivation: the docs route records an agent spending seven 4xx
 * probes guessing endpoints when given a bare link. Seeded RED by the orchestrator.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument, type StoryDocumentInput } from '@/lib/story/document';

const HELP = { docs: 'https://x.test/docs', tokens: 'https://x.test/tokens/new' };
const doc = (over: Partial<StoryDocumentInput> = {}): Promise<string> =>
  buildStoryDocument({
    source: '<h1 className="text-4xl">Hello</h1>',
    compiledCss: null,
    theme: null,
    colorMode: null,
    refData: {},
    title: 'Stored title',
    runtimeSrc: '/story-runtime.js',
    ...over,
  });
const head = (html: string) => html.slice(0, html.indexOf('</head>'));

describe('the agent help pointer in <head>', () => {
  it('renders a help link and a one-line agent meta when the platform passes them', async () => {
    const h = head(await doc({ help: HELP }));
    expect(h).toContain('<link rel="help" href="https://x.test/docs" title="Agents: read this first to edit any artifact here">');
    expect(h).toContain('<meta name="artifactbin:agent" content="To edit this artifact with an agent, read https://x.test/docs — tokens at https://x.test/tokens/new">');
  });
  it('escapes the URLs like every other head value', async () => {
    const h = head(await doc({ help: { docs: 'https://x.test/docs?a=1&b=2', tokens: HELP.tokens } }));
    expect(h).toContain('href="https://x.test/docs?a=1&amp;b=2"');
  });
  it('renders nothing of it when help is absent or null', async () => {
    for (const html of [await doc(), await doc({ help: null })]) {
      expect(head(html)).not.toContain('rel="help"');
      expect(head(html)).not.toContain('artifactbin:agent');
    }
  });
  it('comes after the social tags and before the first script', async () => {
    const h = head(await doc({ help: HELP }));
    const link = h.indexOf('rel="help"');
    expect(link).toBeGreaterThan(h.indexOf('<title>'));
    expect(link).toBeLessThan(h.indexOf('<script>'));
  });
});
