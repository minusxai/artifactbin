/**
 * The frame half of in-place editing, driven the way a user drives it.
 *
 * Rendered through the REAL interpreter with the session's own decorator, so
 * what is asserted is what a document actually does — not a hand-built DOM
 * that happens to agree with the code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import {
  STORY_APPLY_FORMAT_MESSAGE, STORY_EDIT_KEY_MESSAGE, STORY_EDIT_READY_MESSAGE,
  STORY_IMAGE_DROP_MESSAGE, STORY_SELECTION_MESSAGE, STORY_SELECT_MESSAGE, STORY_TEXT_EDIT_MESSAGE, STORY_TYPING_MESSAGE,
  type StoryEditParentMessage,
} from '../../contract';
import type { PristineChannel } from '../../pristine';
import { createFrameEditSession, EDIT_SELECTED_ATTR, EDIT_EMBED_SELECTED_ATTR, EDIT_HOVER_ATTR } from '../session';
import { Video } from '@/components/kit/video';
import type { ReactElement } from 'react';

const NONCE = 'f'.repeat(32);
const SRC = '<div className="p-8"><h1 className="t">Title</h1>'
  + '<p className="lede">hello world</p>'
  + '<div className="box"><span>nested</span></div></div>';

const nodesOf = (src: string): JsxNode[] => {
  const p = parseJsx(src);
  if (!p.ok) throw new Error('fixture does not parse');
  return p.nodes;
};

let posted: Array<Record<string, unknown>>;
let channel: PristineChannel;

const makeChannel = (): PristineChannel => ({
  nonce: NONCE,
  post: (m) => { posted.push(m as Record<string, unknown>); },
  innerHtmlOf: (el) => el.innerHTML,
  isParent: () => true,
  isFromParent: () => true,
});

const sent = (type: string) => posted.filter((m) => m.type === type);
const last = (type: string) => sent(type).at(-1);

/**
 * A stand-in for the component registry — the real embeds are not what this
 * file is about, EXCEPT <Video>, which is the real kit card: whether it
 * renders its link while editing is the thing being asserted.
 */
const COMPONENTS = {
  Question: (props: Record<string, unknown>) => <div {...props} aria-label="Question embed" />,
  Video: Video as unknown as (props: Record<string, unknown>) => ReactElement,
};

/** Every session listens on `document`; one left alive leaks into the next test. */
const live: Array<{ dispose(): void }> = [];

function mount(src = SRC, requestRender = vi.fn()) {
  const nodes = nodesOf(src);
  const session = createFrameEditSession({ win: window, channel, requestRender });
  live.push(session);
  session.setNodes(nodes);
  const view = render(<>{renderStoryNodes(nodes, { components: COMPONENTS, decorateElement: session.decorate })}</>);
  const at = (path: string) => view.container.querySelector(`[data-mx-ast="${path}"]`) as HTMLElement;
  return { session, view, at, requestRender, nodes };
}

beforeEach(() => {
  posted = [];
  channel = makeChannel();
  document.body.innerHTML = '';
});

afterEach(() => {
  while (live.length) live.pop()!.dispose();
});

describe('createFrameEditSession — going in', () => {
  it('announces that edit mode is live', () => {
    mount();
    expect(last(STORY_EDIT_READY_MESSAGE)).toMatchObject({ nonce: NONCE });
  });

  it('makes TEXT HOSTS editable and leaves everything else alone', () => {
    const { at } = mount();
    expect(at('0.0').getAttribute('contenteditable')).toBe('true');   // h1
    expect(at('0.1').getAttribute('contenteditable')).toBe('true');   // p
    expect(at('0').getAttribute('contenteditable')).toBeNull();       // the wrapper
    expect(at('0.2').getAttribute('contenteditable')).toBeNull();     // a container
  });

  it('carries the nonce on EVERY message', () => {
    const { at } = mount();
    fireEvent.focus(at('0.1'));
    fireEvent.input(at('0.1'));
    fireEvent.blur(at('0.1'));
    expect(posted.length).toBeGreaterThan(2);
    expect(posted.every((m) => m.nonce === NONCE)).toBe(true);
  });
});

describe('typing and committing', () => {
  it('reports typing from the first input and stops at the commit', () => {
    const { at } = mount();
    fireEvent.focus(at('0.1'));
    expect(sent(STORY_TYPING_MESSAGE)).toHaveLength(0);   // a parked cursor is not typing
    fireEvent.input(at('0.1'));
    expect(last(STORY_TYPING_MESSAGE)).toMatchObject({ active: true });
    fireEvent.blur(at('0.1'));
    expect(last(STORY_TYPING_MESSAGE)).toMatchObject({ active: false });
  });

  it('sends what the user typed, once, on blur', () => {
    const { at } = mount();
    const host = at('0.1');
    fireEvent.focus(host);
    host.innerHTML = 'hello <b>brave</b> world';
    fireEvent.input(host);
    fireEvent.blur(host);
    expect(sent(STORY_TEXT_EDIT_MESSAGE)).toEqual([
      { type: STORY_TEXT_EDIT_MESSAGE, nonce: NONCE, path: '0.1', innerHtml: 'hello <b>brave</b> world' },
    ]);
  });

  it('sends NOTHING when the user only looked at it', () => {
    const { at } = mount();
    fireEvent.focus(at('0.1'));
    fireEvent.blur(at('0.1'));
    expect(sent(STORY_TEXT_EDIT_MESSAGE)).toHaveLength(0);
  });

  it('sends nothing when the content changed but the USER did not type', () => {
    // Embeds mounting and re-measuring change a host's innerHTML under a
    // parked cursor. Echoing that would write a serialization of render output
    // back into the author's source, unasked.
    const { at } = mount();
    const host = at('0.1');
    fireEvent.focus(host);
    host.innerHTML = 'changed by something that is not a person';
    fireEvent.blur(host);
    expect(sent(STORY_TEXT_EDIT_MESSAGE)).toHaveLength(0);
  });

  it('sends nothing when the content came back to where it started', () => {
    const { at } = mount();
    const host = at('0.1');
    const before = host.innerHTML;
    fireEvent.focus(host);
    host.innerHTML = 'typed';
    fireEvent.input(host);
    host.innerHTML = before;
    fireEvent.blur(host);
    expect(sent(STORY_TEXT_EDIT_MESSAGE)).toHaveLength(0);
  });

  it('releases the focus guard on blur so React can reconcile again', () => {
    const { at, requestRender } = mount();
    fireEvent.focus(at('0.1'));
    fireEvent.blur(at('0.1'));
    expect(requestRender).toHaveBeenCalled();
  });

  it('commits an unfinished edit when edit mode ends', () => {
    const { at, session } = mount();
    const host = at('0.1');
    fireEvent.focus(host);
    host.innerHTML = 'not yet blurred';
    fireEvent.input(host);
    session.dispose();
    expect(last(STORY_TEXT_EDIT_MESSAGE)).toMatchObject({ path: '0.1', innerHtml: 'not yet blurred' });
  });
});

describe('selection', () => {
  it('reports a focused text host', () => {
    const { at } = mount();
    fireEvent.focus(at('0.1'));
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({
      selection: { kind: 'text', path: '0.1', tag: 'p', className: 'lede' },
    });
  });

  /*
   * ADDED (F3). The editor's own "Comment on selection" and the view-mode
   * bubble are two doors to ONE destination, so they must hand the composer the
   * same thing: the words. A caret with nothing selected carries none, rather
   * than the two doors disagreeing about what a comment is about.
   */
  it('carries the selected words with a reported selection, and nothing for a bare caret', () => {
    const { at } = mount();
    const host = at('0.1');
    const range = document.createRange();
    range.setStart(host.firstChild!, 2);
    range.setEnd(host.firstChild!, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.focus(host);
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({
      selection: {
        path: '0.1',
        quote: 'llo wo',
        range: { v: 1, parts: [{ rel: '', start: 2, end: 8, text: 'llo wo' }] },
      },
    });

    window.getSelection()!.removeAllRanges();
    fireEvent.click(at('0.2'), { bubbles: true });
    const reported = (last(STORY_SELECTION_MESSAGE) as { selection: Record<string, unknown> }).selection;
    expect(reported.path).toBe('0.2');
    expect(reported.quote).toBeUndefined();
    expect(reported.range).toBeUndefined();
  });

  it('reports a clicked container, and marks it for the reader', () => {
    const { at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { kind: 'element', path: '0.2', tag: 'div' } });
    expect(at('0.2').hasAttribute(EDIT_SELECTED_ATTR)).toBe(true);
  });

  it('marks a selected COMPONENT with its own attribute', () => {
    const { at } = mount('<div className="p-8"><p>text</p><Question data="$q" /></div>');
    fireEvent.click(at('0.1'), { bubbles: true });
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { kind: 'embed', tag: 'Question' } });
    expect(at('0.1').hasAttribute(EDIT_EMBED_SELECTED_ATTR)).toBe(true);
    expect(at('0.1').hasAttribute(EDIT_SELECTED_ATTR)).toBe(false);
  });

  it('clears the selection when the click lands on nothing', () => {
    const { at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    fireEvent.click(document.body, { bubbles: true });
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: null });
    expect(document.querySelectorAll(`[${EDIT_SELECTED_ATTR}]`)).toHaveLength(0);
  });

  it('IGNORES a click in the deck rail — its previews are copies of the slides', () => {
    const { at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    const before = posted.length;
    const rail = document.createElement('nav');
    rail.className = 'mx-rail';
    rail.innerHTML = '<p data-mx-ast="0.1">a preview copy</p>';
    document.body.appendChild(rail);
    fireEvent.click(rail.querySelector('p')!, { bubbles: true });
    expect(posted).toHaveLength(before);
  });

  it('selects by path when the parent asks (a breadcrumb click), and clears on null', () => {
    const { session, at } = mount();
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: '0.2' } as StoryEditParentMessage);
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { path: '0.2' } });
    expect(at('0.2').hasAttribute(EDIT_SELECTED_ATTR)).toBe(true);
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: null } as StoryEditParentMessage);
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: null });
  });
});

describe('hover boundaries', () => {
  it('marks the selectable node under the pointer and transfers the boundary as it moves', () => {
    const { at } = mount();

    fireEvent.pointerOver(at('0.2'));
    expect(at('0.2').hasAttribute(EDIT_HOVER_ATTR)).toBe(true);

    fireEvent.pointerOver(at('0.1'));
    expect(at('0.2').hasAttribute(EDIT_HOVER_ATTR)).toBe(false);
    expect(at('0.1').hasAttribute(EDIT_HOVER_ATTR)).toBe(true);

    fireEvent.pointerOut(at('0.1'), { relatedTarget: document.body });
    expect(document.querySelectorAll(`[${EDIT_HOVER_ATTR}]`)).toHaveLength(0);
  });

  it('does not preview duplicate nodes in the deck rail', () => {
    mount();
    const rail = document.createElement('nav');
    rail.className = 'mx-rail';
    rail.innerHTML = '<p data-mx-ast="0.1">a preview copy</p>';
    document.body.appendChild(rail);

    fireEvent.pointerOver(rail.querySelector('p')!);
    expect(document.querySelectorAll(`[${EDIT_HOVER_ATTR}]`)).toHaveLength(0);
  });
});

describe('keys', () => {
  it('asks the parent to delete the SELECTED node', () => {
    const { at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(last(STORY_EDIT_KEY_MESSAGE)).toMatchObject({ key: 'Delete' });
  });

  it('leaves Delete alone while a text host has focus — those keys are the text\'s', () => {
    const { at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    fireEvent.focus(at('0.1'));
    fireEvent.keyDown(document, { key: 'Delete' });
    fireEvent.keyDown(document, { key: 'Backspace' });
    expect(sent(STORY_EDIT_KEY_MESSAGE)).toHaveLength(0);
  });

  it('says nothing about Delete when nothing is selected', () => {
    mount();
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(sent(STORY_EDIT_KEY_MESSAGE)).toHaveLength(0);
  });

  it('forwards Escape whatever is happening', () => {
    mount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(last(STORY_EDIT_KEY_MESSAGE)).toMatchObject({ key: 'Escape' });
  });
});

describe('applying a format', () => {
  it('sets the class on the live element, instantly and without a re-render', () => {
    const { session, at } = mount();
    session.onParentMessage({ type: STORY_APPLY_FORMAT_MESSAGE, path: '0.0', className: 'text-5xl font-bold' } as StoryEditParentMessage);
    expect(at('0.0').getAttribute('class')).toBe('text-5xl font-bold');
  });

  it('sets and removes an inline style', () => {
    const { session, at } = mount();
    session.onParentMessage({ type: STORY_APPLY_FORMAT_MESSAGE, path: '0.0', style: 'color: red' } as StoryEditParentMessage);
    expect(at('0.0').getAttribute('style')).toBe('color: red');
    session.onParentMessage({ type: STORY_APPLY_FORMAT_MESSAGE, path: '0.0', style: '' } as StoryEditParentMessage);
    expect(at('0.0').hasAttribute('style')).toBe(false);
  });

  it('removes the class attribute when the whole class string goes', () => {
    const { session, at } = mount();
    session.onParentMessage({ type: STORY_APPLY_FORMAT_MESSAGE, path: '0.0', className: '' } as StoryEditParentMessage);
    expect(at('0.0').hasAttribute('class')).toBe(false);
  });

  it('is a no-op for a path that is not on screen', () => {
    const { session } = mount();
    expect(() => session.onParentMessage(
      { type: STORY_APPLY_FORMAT_MESSAGE, path: '9.9', className: 'x' } as StoryEditParentMessage,
    )).not.toThrow();
  });
});

describe('links', () => {
  /** Put a real selection inside a host, the way a user does before linking. */
  const selectInside = (el: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  };

  it('REFUSES an active-content scheme, whoever asked for it', () => {
    const { session, at } = mount();
    selectInside(at('0.1'));
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', ' JaVaScRiPt:alert(1)']) {
      session.onParentMessage({ type: 'mx:apply-link', path: '0.1', href } as StoryEditParentMessage);
    }
    expect(at('0.1').querySelector('a')).toBeNull();
    expect(sent(STORY_TEXT_EDIT_MESSAGE)).toHaveLength(0);
  });

  it('makes an ordinary link, and reports the host\'s new content', () => {
    const { session, at } = mount();
    selectInside(at('0.1'));
    session.onParentMessage({ type: 'mx:apply-link', path: '0.1', href: 'https://example.com' } as StoryEditParentMessage);
    const anchor = at('0.1').querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://example.com');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(last(STORY_TEXT_EDIT_MESSAGE)).toMatchObject({ path: '0.1' });
  });

  it('normalises a bare domain rather than refusing it', () => {
    const { session, at } = mount();
    selectInside(at('0.1'));
    session.onParentMessage({ type: 'mx:apply-link', path: '0.1', href: 'example.com/docs' } as StoryEditParentMessage);
    expect(at('0.1').querySelector('a')?.getAttribute('href')).toBe('https://example.com/docs');
  });

  // The scheme is case-insensitive, and the check that runs at the sink is a
  // literal-prefix one — a shouted scheme must still be a link, not a no-op.
  it('takes a link whose scheme is shouted', () => {
    const { session, at } = mount();
    selectInside(at('0.1'));
    session.onParentMessage({ type: 'mx:apply-link', path: '0.1', href: 'HTTPS://Example.com/Path' } as StoryEditParentMessage);
    expect(at('0.1').querySelector('a')?.getAttribute('href')).toBe('https://Example.com/Path');
  });
});

describe('embeds that would navigate', () => {
  const VIDEO = '<div className="p-8"><p>text</p>'
    + '<Video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" title="a talk" /></div>';

  it('renders <Video> WITHOUT its link, so a click selects the embed', () => {
    const { at } = mount(VIDEO);
    // The reader's card is an <a> to the video's own page. In edit mode that
    // link would swallow the click that is supposed to select the embed — and
    // take the author out of their document to youtube.
    expect(at('0.1').querySelector('a')).toBeNull();
    fireEvent.click(at('0.1'), { bubbles: true });
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { kind: 'embed', tag: 'Video' } });
    expect(at('0.1').hasAttribute(EDIT_EMBED_SELECTED_ATTR)).toBe(true);
  });

  it('leaves the card itself alone — it is still a video card', () => {
    const { at } = mount(VIDEO);
    expect(at('0.1').getAttribute('data-slot')).toBe('video');
    expect(at('0.1').querySelector('[data-slot="video-play"]')).not.toBeNull();
  });
});

describe('a new document arriving underneath', () => {
  it('drops a selection the new document no longer has', () => {
    const { session, at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    expect(at('0.2').hasAttribute(EDIT_SELECTED_ATTR)).toBe(true);
    act(() => { document.body.innerHTML = ''; });
    session.setNodes(nodesOf('<div className="p-8"><p>only this now</p></div>'));
    expect(document.querySelectorAll(`[${EDIT_SELECTED_ATTR}]`)).toHaveLength(0);
  });
});

describe('leaving edit mode', () => {
  it('stops listening and takes its chrome with it', () => {
    const { session, at } = mount();
    fireEvent.pointerOver(at('0.1'));
    fireEvent.click(at('0.2'), { bubbles: true });
    session.dispose();
    const after = posted.length;
    fireEvent.click(at('0.0'), { bubbles: true });
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(posted).toHaveLength(after);
    expect(document.querySelectorAll(`[${EDIT_SELECTED_ATTR}], [${EDIT_EMBED_SELECTED_ATTR}], [${EDIT_HOVER_ATTR}]`)).toHaveLength(0);
    expect(document.head.querySelector('[data-mx-edit-css]')).toBeNull();
  });
});

/**
 * Pasting or dropping an image while editing.
 *
 * The listeners have to live HERE. The document is its own window, so a paste
 * inside it never reaches the parent's `paste` handler — which is exactly how
 * this feature was lost when editing moved into the served document, and why
 * the parent-side gate could not see it go.
 */
describe('createFrameEditSession — inserting an image by paste or drop', () => {
  const png = () => new File(['x'], 'clip.png', { type: 'image/png' });

  const fire = (kind: 'paste' | 'drop', data: unknown) => {
    const event = new Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(event, kind === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data });
    document.dispatchEvent(event);
    return event;
  };
  const transfer = (files: File[]) => ({ items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })), files });

  it('posts a pasted image to the parent', () => {
    mount();
    const file = png();
    fire('paste', transfer([file]));
    expect(last(STORY_IMAGE_DROP_MESSAGE)).toMatchObject({ nonce: NONCE, file });
  });

  it('posts a dropped image to the parent', () => {
    mount();
    const file = png();
    fire('drop', transfer([file]));
    expect(last(STORY_IMAGE_DROP_MESSAGE)).toMatchObject({ nonce: NONCE, file });
  });

  it('takes the event over, so the browser does not also drop the file into the page', () => {
    mount();
    expect(fire('drop', transfer([png()])).defaultPrevented).toBe(true);
    expect(fire('paste', transfer([png()])).defaultPrevented).toBe(true);
  });

  it('LEAVES A TEXT PASTE ALONE — typing is the common act', () => {
    mount();
    const event = fire('paste', { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], files: [] });
    expect(sent(STORY_IMAGE_DROP_MESSAGE)).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores a non-image drop rather than eating it', () => {
    mount();
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    const event = fire('drop', { items: [{ kind: 'file', type: pdf.type, getAsFile: () => pdf }], files: [pdf] });
    expect(sent(STORY_IMAGE_DROP_MESSAGE)).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it('stops listening once the session is disposed', () => {
    const { session } = mount();
    session.dispose();
    fire('paste', transfer([png()]));
    expect(sent(STORY_IMAGE_DROP_MESSAGE)).toHaveLength(0);
  });
});
