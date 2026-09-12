/**
 * WYSIWYG AST write-back for format:'jsx' stories — the TEXT path.
 *
 * `applyDomEditsToJsx` maps a contenteditable host's edited innerHTML back onto
 * the JSX source: locate the element by its `data-mx-ast` path, convert the
 * HTML to sanitized JSX nodes (validator-allowlisted tags/attrs only — hostile
 * paste stripped, never saved), splice component/embed children back from the
 * ORIGINAL AST, and re-serialize. `isEditableTextHost` decides which elements
 * are offered to that path at all, so it lives here.
 */
import { describe, it, expect } from 'vitest';

import { applyDomEditsToJsx, isEditableTextHost } from '@/lib/data/story/jsx-edit';
import { parseJsx, validateJsxSource, type JsxElement } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/story-ui/component-names';
import { expectValidStoryJsx, parseJsxOrThrow } from '@/test/helpers/jsx';

describe('applyDomEditsToJsx — text edits', () => {
  it('replaces a paragraph\'s text (simple text edit)', () => {
    const src = '<div><p>Hello world</p></div>';
    const { source, errors } = applyDomEditsToJsx(src, [{ astPath: '0.0', innerHtml: 'Goodbye world' }]);
    expect(errors).toEqual([]);
    expect(source).toBe('<div><p>Goodbye world</p></div>');
    expectValidStoryJsx(source);
  });

  it('keeps rich inline children — an edited <strong> word survives the round-trip', () => {
    const src = '<p>Hello <strong>bold</strong> world</p>';
    const { source, errors } = applyDomEditsToJsx(src, [
      // The DOM copy carries the interpreter's data-mx-ast stamp on the inline element;
      // it is a plain HTML tag, so the (edited) DOM copy wins and the stamp is stripped.
      { astPath: '0', innerHtml: 'Hello <strong data-mx-ast="0.1">bolder</strong> world!' },
    ]);
    expect(errors).toEqual([]);
    expect(source).toBe('<p>Hello <strong>bolder</strong> world!</p>');
    expect(source).not.toContain('data-mx-ast');
    expectValidStoryJsx(source);
  });

  it('decodes HTML entities and self-closes void tags', () => {
    const src = '<p>x</p>';
    const { source, errors } = applyDomEditsToJsx(src, [
      { astPath: '0', innerHtml: 'a &amp; b &lt;c&gt;&nbsp;d<br>e' },
    ]);
    expect(errors).toEqual([]);
    expect(source).toContain('<br />');
    const parsed = parseJsx(source);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const p = parsed.nodes[0] as JsxElement;
    const text = p.children.filter(c => c.type === 'text').map(c => (c as { value: string }).value).join('');
    expect(text).toBe('a & b <c> de');
    expectValidStoryJsx(source);
  });
});

describe('applyDomEditsToJsx — hostile paste sanitization', () => {
  it('drops pasted ping lists with a later dangerous URL while preserving safe lists', () => {
    const safe = 'https://safe.example/p,javascript:literal https://other.example/p';
    const { source, errors } = applyDomEditsToJsx('<p>x</p>', [{
      astPath: '0',
      innerHtml: `<a href="/" ping="https://safe.example/p javascript:alert(1)">unsafe</a><a href="/" ping="${safe}">safe</a>`,
    }]);
    expect(source).toContain('<a href="/">unsafe</a>');
    expect(source).toContain(`ping="${safe}"`);
    expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({ attr: 'ping' })]));
    expectValidStoryJsx(source);
  });

  it('strips onclick attributes, <iframe> elements and javascript: hrefs out of the result', () => {
    const src = '<p>safe</p>';
    const { source } = applyDomEditsToJsx(src, [{
      astPath: '0',
      innerHtml:
        'Hi <span onclick="evil()">x</span>' +
        '<iframe src="https://evil.example/"></iframe>' +
        '<a href="javascript:alert(1)">link</a>' +
        '<script>steal()</script> bye',
    }]);
    expect(source).not.toContain('onclick');
    expect(source).not.toContain('iframe');
    expect(source).not.toContain('javascript:');
    expect(source).not.toContain('steal()');
    expect(source).toContain('<span>x</span>');
    expect(source).toContain('<a>link</a>'); // element kept, poisoned href dropped
    expect(source).toContain('Hi ');
    expect(source).toContain(' bye');
    expectValidStoryJsx(source);
  });

  it('sanitizes obfuscated URL schemes and denied attributes', () => {
    const { source } = applyDomEditsToJsx('<p>x</p>', [{
      astPath: '0',
      innerHtml: '<a href="java\tscript:alert(1)" is="x-evil" srcdoc="<script>">t</a>',
    }]);
    expect(source).not.toContain('script:');
    expect(source).not.toContain('is=');
    expect(source).not.toContain('srcdoc');
    expect(source).toContain('<a>t</a>');
    expectValidStoryJsx(source);
  });

  it('strips inline style attributes off pasted rich text — the publish door forbids them', () => {
    // A paste from Google Docs / Word / any web page arrives as spans carrying
    // style="…". The publish validator runs stylePolicy 'no-inline-style', so a
    // write-back that keeps them composes fine and then CANNOT SAVE — the user
    // sees an error naming style= they never typed. The sanitizer must launder
    // them away like every other attribute the door would refuse.
    const src = '<p>safe</p>';
    const { source, errors } = applyDomEditsToJsx(src, [{
      astPath: '0',
      innerHtml:
        'x <span style="color: rgb(34, 34, 34); font-family: Arial; font-size: 11pt;">pasted</span>' +
        ' <b labelStyle="color:red">bold</b> y',
    }]);
    expect(source).not.toContain('style=');
    expect(source).not.toContain('labelStyle');
    expect(source).toContain('<span>pasted</span>');
    expect(source).toContain('<b>bold</b>');
    // The drop is reported, but the edit itself still lands as clean text.
    expect(errors.some((e) => /style/i.test(e.message))).toBe(true);
    expectValidStoryJsx(source);
    // What lands must pass the DOOR's policy, not just the default one.
    expect(validateJsxSource(source, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS, 'no-inline-style')).toEqual([]);
  });

  it('unwraps non-allowlisted (but not dangerous) tags, keeping their text', () => {
    const { source } = applyDomEditsToJsx('<p>x</p>', [{
      astPath: '0', innerHtml: 'a <font color="red">red</font> b',
    }]);
    expect(source).not.toContain('font');
    expect(source).toContain('a red b');
    expectValidStoryJsx(source);
  });
});

describe('applyDomEditsToJsx — attribute canonicalization', () => {
  it('normalizes DOM `class` attributes to className on edited inline elements', () => {
    // contenteditable innerHTML always serializes `class=` — the JSX source canon is className.
    const { source, errors } = applyDomEditsToJsx('<p>x</p>', [
      { astPath: '0', innerHtml: 'a <em class="italic">b</em>' },
    ]);
    expect(errors).toEqual([]);
    expect(source).toBe('<p>a <em className="italic">b</em></p>');
    expectValidStoryJsx(source);
  });
});

describe('applyDomEditsToJsx — embed/component preservation', () => {
  it('preserves a <Number id={5}/> inside the edited paragraph verbatim (from the AST, not the DOM)', () => {
    const src = '<p>Revenue <Number id={5} suffix="%" /> up</p>';
    const { source, errors } = applyDomEditsToJsx(src, [{
      astPath: '0',
      // The embed's rendered DOM chrome is NOT parseable back to JSX — the data-mx-ast stamp
      // marks it and the ORIGINAL AST child is spliced back in its place.
      innerHtml: 'Revenue was <span data-mx-ast="0.1" contenteditable="false">42%</span> way up',
    }]);
    expect(errors).toEqual([]);
    expect(source).toBe('<p>Revenue was <Number id={5} suffix="%" /> way up</p>');
    expectValidStoryJsx(source);
  });

  it('preserves an <Icon/> whose rendered chrome is an svg root (the stamp wins over the svg allowlist)', () => {
    const src = '<p>Done <Icon name="circle-check" /> now</p>';
    const { source, errors } = applyDomEditsToJsx(src, [{
      astPath: '0',
      innerHtml: 'All done <svg data-mx-ast="0.1" contenteditable="false" class="size-4"><path d="M1 1" /></svg> for real',
    }]);
    expect(errors).toEqual([]);
    expect(source).toBe('<p>All done <Icon name="circle-check" /> for real</p>');
    expectValidStoryJsx(source);
  });
});

describe('applyDomEditsToJsx — batches and failure modes', () => {
  it('applies a multi-edit batch against one source', () => {
    const src = '<div><p>one</p><p>two</p></div><p>three</p>';
    const { source, errors } = applyDomEditsToJsx(src, [
      { astPath: '0.0', innerHtml: 'ONE' },
      { astPath: '0.1', innerHtml: 'TWO <em>now</em>' },
      { astPath: '1', innerHtml: 'THREE' },
    ]);
    expect(errors).toEqual([]);
    expect(source).toBe('<div><p>ONE</p><p>TWO <em>now</em></p></div><p>THREE</p>');
    expectValidStoryJsx(source);
  });

  it('reports an error and leaves the source untouched for an unresolvable AST path', () => {
    const src = '<p>keep</p>';
    const { source, errors } = applyDomEditsToJsx(src, [{ astPath: '9.9', innerHtml: 'x' }]);
    expect(errors.length).toBeGreaterThan(0);
    expect(source).toBe('<p>keep</p>');
  });

  it('returns the original source with an error when the source itself does not parse', () => {
    const bad = '<p>unterminated';
    const { source, errors } = applyDomEditsToJsx(bad, [{ astPath: '0', innerHtml: 'x' }]);
    expect(source).toBe(bad);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('isEditableTextHost', () => {
  const el = (src: string): JsxElement => {
    const parsed = parseJsxOrThrow(src);
    return parsed.nodes[0] as JsxElement;
  };

  it('accepts an element with non-whitespace text children and inline markup', () => {
    expect(isEditableTextHost(el('<p>Hello <strong>bold</strong></p>'))).toBe(true);
  });

  it('rejects elements without direct non-whitespace text', () => {
    expect(isEditableTextHost(el('<div>  <p>text</p></div>'))).toBe(false);
    expect(isEditableTextHost(el('<div><p>text</p></div>'))).toBe(false);
  });

  it('accepts hosts carrying INLINE embeds — the embed is spliced back, the prose is editable', () => {
    expect(isEditableTextHost(el('<p>Revenue <Number id={5} /> up</p>'))).toBe(true);
    expect(isEditableTextHost(el('<p>Deep <span><Number id={5} /></span> one</p>'))).toBe(true);
    expect(isEditableTextHost(el('<p>Done <Icon name="circle-check" /> now</p>'))).toBe(true);
  });

  it('rejects hosts with BLOCK component descendants (their chrome stays locked)', () => {
    expect(isEditableTextHost(el('<p>Chart <Question data="ref:abc123" /> here</p>'))).toBe(false);
    expect(isEditableTextHost(el('<h1>Status <Badge>live</Badge></h1>'))).toBe(false);
    expect(isEditableTextHost(el('<p>Deep <span><Question data="ref:abc123" /></span> one</p>'))).toBe(false);
  });

  it('rejects components themselves and <style> hosts', () => {
    expect(isEditableTextHost(el('<CardTitle>Title</CardTitle>'))).toBe(false);
    expect(isEditableTextHost(el('<style>p &#123; color: red &#125;</style>'))).toBe(false);
  });

  /*
   * Moved here from svg-edit.test.ts, which tested this same predicate on its own.
   * SVG internals are drawing, not prose: contenteditable inside an <svg> subtree is
   * undefined browser behaviour and the write-back would splice drawing coordinates
   * as text, so the subset stays atomic however much text it carries.
   */
  const inside = (src: string): JsxElement => el(src).children[0] as JsxElement;

  it('rejects svg <text> with direct text — the subset is atomic', () => {
    expect(isEditableTextHost(inside('<svg><text x="0" y="10">label</text></svg>'))).toBe(false);
  });

  it('rejects svg <title>/<desc>', () => {
    expect(isEditableTextHost(inside('<svg><title>a11y name</title></svg>'))).toBe(false);
    expect(isEditableTextHost(inside('<svg><desc>a long description</desc></svg>'))).toBe(false);
  });

  it('an ordinary <p> beside the svg still is a text host', () => {
    expect(isEditableTextHost(inside('<div><p>prose</p></div>'))).toBe(true);
  });
});
