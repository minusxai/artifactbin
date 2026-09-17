/**
 * Authored CSS through the publish door — written in `<Helmet><style>`, the one
 * home for it (a body `<style>` is refused and told where it belongs, because
 * CSS in a body block styles the whole document wherever it sits). The policy
 * lets an agent write arbitrary CSS (keyframes, complex selectors) attached to
 * classes — in-distribution vocabulary — while the door still enforces:
 *  - the banned-css strip (position:fixed/sticky, external url()/@import) on
 *    style-block content, declaration-level;
 *  - the viewport-height remap (a raw `100vh` inside the content-sized iframe
 *    is the no-fixed-point sizing bug — see lib/story-surface/viewport-units);
 *  - inline `style=` stays rejected (the editor's class algebra can't merge it).
 * And the compiled sheet now carries `!important` utilities, so Tailwind
 * classes always beat authored CSS — the instructable cascade contract.
 */
import { publishJsx } from '../jsx-tier';
import type { StoredContent } from '../input';

const publish = async (markup: string) =>
  publishJsx({}, markup) as Promise<StoredContent | Response>;

const STYLE_DOC = `<Helmet><style>{\`
@keyframes rise { from { opacity: 0; transform: translateY(2rem) } }
.rise { animation: rise 0.9s both }
.hero-band { height: 100vh; position: fixed; background: var(--primary) }
\`}</style></Helmet>
<div data-design="tw" className="@container p-8">
<p className="rise font-bold">hello</p>
</div>`;

describe('publishJsx with an authored <Helmet><style> block', () => {
  it('accepts the document and stores the CSS (keyframes survive)', async () => {
    const stored = await publish(STYLE_DOC);
    expect(stored).not.toBeInstanceOf(Response);
    const { source } = stored as StoredContent;
    expect(source).toContain('@keyframes rise');
    expect(source).toContain('.rise');
  });

  it('strips banned declarations from style content, keeping siblings', async () => {
    const stored = (await publish(STYLE_DOC)) as StoredContent;
    expect(stored.source).not.toMatch(/position:\s*fixed/);
    expect(stored.source).toContain('background: var(--primary)');
  });

  it('remaps viewport-height units in style content to the host contract', async () => {
    const stored = (await publish(STYLE_DOC)) as StoredContent;
    expect(stored.source).not.toMatch(/:\s*100vh/);
    expect(stored.source).toContain('var(--mx-vh,760px)');
  });

  it('still rejects inline style attributes', async () => {
    const res = await publish('<div data-design="tw" style="color:red"><p>x</p></div>');
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
  });

  it('compiles utilities with !important so Tailwind always beats authored CSS', async () => {
    const stored = (await publish(STYLE_DOC)) as StoredContent;
    const css = stored.meta.compiledCss as string;
    const fontBold = css.slice(css.indexOf('.font-bold'));
    expect(fontBold.slice(0, fontBold.indexOf('}'))).toContain('!important');
  });

  it('round-trips: the stored source republishes unchanged (canonical fixpoint)', async () => {
    const first = (await publish(STYLE_DOC)) as StoredContent;
    const second = (await publish(first.source!)) as StoredContent;
    expect(second.source).toBe(first.source);
  });
});
