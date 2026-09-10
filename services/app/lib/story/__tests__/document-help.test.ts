/**
 * DISCOVER (cleanup/discover): a served artifact tells an agent how to edit it. An agent given a pasted link fetches
 * the document and finds, in <head>, a `<link rel="help">` to the docs index and a one-line `<meta name="artifactbin:agent">`
 * naming the docs and /tokens/new. Measured motivation: the docs route records an agent spending seven 4xx
 * probes guessing endpoints when given a bare link. Seeded RED by the orchestrator.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument, type StoryDocumentInput } from '@/lib/story/document';

const HELP = { url: 'https://x.test/llms.txt', instruction: 'Run afbin setup --server https://x.test' };
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
    expect(h).toContain('<link rel="help" href="https://x.test/llms.txt" title="Install the artifactbin CLI and local skills">');
    expect(h).toContain('<meta name="artifactbin:agent" content="Run afbin setup --server https://x.test">');
  });
  it('escapes the URLs like every other head value', async () => {
    const h = head(await doc({ help: { url: 'https://x.test/llms.txt?a=1&b=2', instruction: HELP.instruction } }));
    expect(h).toContain('href="https://x.test/llms.txt?a=1&amp;b=2"');
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
