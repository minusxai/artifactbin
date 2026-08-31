/**
 * The interactive vocabulary — the elements an author's `<script>` exists to
 * drive.
 *
 * Allowing author JavaScript without allowing a `<button>` is an incoherent
 * product: a scripted document could not be written at all. Found by trying
 * to author one.
 *
 * The denials stay denied: nested browsing contexts, navigation hijacks and
 * anything executable outside <Helmet> are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { validateJsxSource } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { findExternalSubresources } from '@/lib/story/refs';

const validate = (src: string) =>
  validateJsxSource(src, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS, 'no-inline-style');

describe('interactive elements a script can drive', () => {
  it.each([
    ['button', '<button id="go">count up</button>'],
    ['input', '<input id="name" type="text" placeholder="your name" />'],
    ['textarea', '<textarea id="note" rows={3}></textarea>'],
    ['select', '<select id="pick"><option value="a">A</option><option value="b">B</option></select>'],
    ['label', '<label htmlFor="name">Name</label>'],
    ['fieldset', '<fieldset><legend>Group</legend><input type="checkbox" /></fieldset>'],
    ['canvas', '<canvas id="plot" width={400} height={200}></canvas>'],
    ['output', '<output id="sum">0</output>'],
    ['meter', '<meter value={0.6}></meter>'],
    ['progress', '<progress value={30} max={100}></progress>'],
    ['datalist', '<datalist id="opts"><option value="x"></option></datalist>'],
    ['dialog', '<dialog id="info"><p>Hello</p></dialog>'],
    ['template', '<template id="row"><li>item</li></template>'],
  ])('allows <%s>', (_tag, src) => {
    expect(validate(src)).toEqual([]);
  });

  /**
   * `<audio>`/`<video>` are deliberately NOT here. A self-contained document
   * could only carry media as inline `data:` bytes, and the ported URL gate
   * admits `data:image/` alone — widening a security denylist in the vendored
   * engine buys a clip that barely fits under the 2 MB document cap anyway.
   * Hosted video has a real answer already: the `<Video>` component, a
   * click-to-open card for the three allowlisted hosts (video-embed.ts).
   */
  it('does not pretend to support media it cannot serve self-contained', () => {
    expect(validate('<video src="data:video/mp4;base64,AAAA"></video>').length).toBeGreaterThan(0);
    // An <img src> URL is IMPORTED at the door now (lib/story/external-images)
    // rather than refused, so the stored document is still self-contained —
    // by owning a copy instead of by rejecting the author. Every OTHER
    // subresource position keeps the hard refusal:
    expect(findExternalSubresources('<img srcSet="https://cdn.example/x.png 1x" />').length).toBeGreaterThan(0);
    expect(findExternalSubresources('<div background="https://cdn.example/b.png" />').length).toBeGreaterThan(0);
  });

  it('keeps every dangerous tag denied, in the body', () => {
    for (const src of [
      '<iframe src="data:text/html,x"></iframe>',
      '<form action="/x"><button>go</button></form>',
      '<object data="x"></object>',
      '<embed src="x" />',
      '<base href="/" />',
      '<script>{`alert(1)`}</script>',
    ]) {
      expect(validate(src).length, src).toBeGreaterThan(0);
    }
  });

  it('keeps event handlers denied — a script attaches its own listeners', () => {
    expect(validate('<button onClick="alert(1)">x</button>').length).toBeGreaterThan(0);
    expect(validate('<input onchange="x()" />').length).toBeGreaterThan(0);
  });
});
