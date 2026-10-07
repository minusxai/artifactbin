/** Agent discovery in the compiled reader's assembled document. */
import { describe, expect, it } from 'vitest';
import { AGENT_HELP_TITLE } from '@/lib/serving';
import { assembleReaderPage } from '@/lib/compiled-page/assembler';
import type { AssembleHead, AssembleInput, CompiledPage } from '@/lib/compiled-page/contract';

const HELP = { url: 'https://x.test/llms.txt', instruction: 'afbin: a CLI to operate artifacts. Install: curl -fsSL https://x.test/chat/install.sh | sh' };
const build = { id: 'b'.repeat(16), manifest: {} };
const compiled: CompiledPage = {
  build: build.id, html: '<h1>Hello</h1>', islands: [], module: null, ssr: null,
  behaviors: [], plan: null, readsViewerMarkup: false, links: { prefetch: [], prerender: [] },
  kit: { skeleton: [], islands: [] }, reactStatic: [], unported: [], partial: [], authorScript: null,
  outline: [], outlinePlan: false,
};
const doc = (head: AssembleHead | null = null): string => {
  const input: AssembleInput = {
    compiled, story: compiled.html, css: '', fontPreloads: [], title: 'Stored title',
    theme: null, colorMode: 'light', snapshot: null,
    overlay: { values: {}, mermaidImages: {}, signedIn: false, doors: null },
    build, head,
  };
  return assembleReaderPage(input).html;
};
const head = (html: string) => html.slice(0, html.indexOf('</head>'));

const withHelp = (help: AssembleHead['help']): AssembleHead => ({ social: { title: 'Stored title', image: 'https://x.test/card' }, help });

describe('the compiled document agent pointer', () => {
  it('renders a help link and a one-line afbin meta when the platform passes them', () => {
    const h = head(doc(withHelp(HELP)));
    expect(h).toContain(`<link rel="help" href="https://x.test/llms.txt" title="${AGENT_HELP_TITLE}">`);
    expect(h).toContain(`<meta name="afbin" content="${HELP.instruction}">`);
  });
  it('escapes the URL like every other head value', () => {
    expect(head(doc(withHelp({ ...HELP, url: 'https://x.test/llms.txt?a=1&b=2' })))).toContain('href="https://x.test/llms.txt?a=1&amp;b=2"');
  });
  it('renders nothing when help is absent or null', () => {
    for (const html of [doc(), doc(withHelp(null))]) {
      expect(head(html)).not.toContain('rel="help"');
      expect(head(html)).not.toContain('name="afbin"');
    }
  });
  it('comes before the page title and no inline script follows it', () => {
    const h = head(doc(withHelp(HELP)));
    expect(h.indexOf('rel="help"')).toBeLessThan(h.indexOf('<title>'));
    expect(h).not.toContain('<script');
  });
});
