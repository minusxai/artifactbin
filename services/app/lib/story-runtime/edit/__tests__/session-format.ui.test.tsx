/**
 * WHAT AN EDIT DOES TO THE LIVE DOCUMENT: a class or inline style applied
 * without a re-render, a link made (or refused), an embed that must not
 * navigate while editing, an image pasted or dropped into the frame — and
 * what leaving takes with it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, act } from '@testing-library/react';
import {
  STORY_APPLY_FORMAT_MESSAGE,
  STORY_IMAGE_DROP_MESSAGE,
  STORY_IMAGE_REPLACE_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_SELECT_MESSAGE,
  STORY_TEXT_EDIT_MESSAGE,
  type StoryEditParentMessage,
} from '@/lib/story-runtime/contract';
import { EDIT_SELECTED_ATTR, EDIT_EMBED_SELECTED_ATTR, EDIT_HOVER_ATTR, EDIT_DROP_REPLACE_ATTR } from '@/lib/story-runtime/edit/session';
import {
  NONCE,
  disposeEditSessions,
  env,
  installEditSession,
  last,
  mount,
  nodesOf,
  sent,
} from '@/test/helpers/edit-session';

beforeEach(installEditSession);
afterEach(disposeEditSessions);

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
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: '0.2' } as StoryEditParentMessage);
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
    const after = env.posted.length;
    fireEvent.click(at('0.0'), { bubbles: true });
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(env.posted).toHaveLength(after);
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

/**
 * REPLACING an image, from inside the document: the frame says WHICH image the
 * person meant — by double-clicking it, dropping a file onto it, or pasting
 * while it is selected — and the parent does the rest. Anywhere else a file
 * still inserts.
 */
describe('createFrameEditSession — replacing an image', () => {
  const IMG_SRC = '<div className="p-8"><p className="lede">text</p>'
    + '<img src="https://example.com/a.png" alt="a chart" className="rounded-xl" /><p>after</p></div>';
  const png = () => new File(['x'], 'clip.png', { type: 'image/png' });
  const transfer = (files: File[]) => ({
    types: ['Files'], items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })), files,
  });
  const fireOn = (target: EventTarget, kind: string, data: unknown, init: Record<string, unknown> = {}) => {
    const event = new Event(kind, { bubbles: true, cancelable: true });
    Object.defineProperty(event, kind === 'paste' ? 'clipboardData' : 'dataTransfer', { value: data });
    for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  const label = () => document.querySelector('[data-mx-drop-replace-label]');

  it('a double-click on an image selects it and asks the page to replace it', () => {
    const { at } = mount(IMG_SRC);
    fireEvent.doubleClick(at('0.1'));
    expect(last(STORY_IMAGE_REPLACE_MESSAGE)).toMatchObject({ nonce: NONCE, path: '0.1' });
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { path: '0.1', tag: 'img' } });
  });

  it('a double-click on text asks nothing — that is selecting a word', () => {
    const { at } = mount(IMG_SRC);
    fireEvent.doubleClick(at('0.0'));
    expect(sent(STORY_IMAGE_REPLACE_MESSAGE)).toHaveLength(0);
  });

  it('a file dropped ONTO an image names it; dropped elsewhere it does not', () => {
    const { at } = mount(IMG_SRC);
    const file = png();
    expect(fireOn(at('0.1'), 'drop', transfer([file])).defaultPrevented).toBe(true);
    expect(last(STORY_IMAGE_DROP_MESSAGE)).toMatchObject({ file, target: '0.1' });
    fireOn(at('0.0'), 'drop', transfer([file]));
    expect(last(STORY_IMAGE_DROP_MESSAGE)).not.toHaveProperty('target');
  });

  it('a paste while an image is selected replaces it; with text selected it inserts', () => {
    const { at } = mount(IMG_SRC);
    fireEvent.click(at('0.1'), { bubbles: true });
    fireOn(document, 'paste', transfer([png()]));
    expect(last(STORY_IMAGE_DROP_MESSAGE)).toMatchObject({ target: '0.1' });
    fireEvent.click(at('0.2'), { bubbles: true });
    fireOn(document, 'paste', transfer([png()]));
    expect(last(STORY_IMAGE_DROP_MESSAGE)).not.toHaveProperty('target');
  });

  it('dragging a file over an image marks it "Drop to replace", and the mark follows the pointer out', () => {
    const { at } = mount(IMG_SRC);
    const over = fireOn(at('0.1'), 'dragover', transfer([png()]));
    expect(over.defaultPrevented).toBe(true);
    expect(at('0.1').hasAttribute(EDIT_DROP_REPLACE_ATTR)).toBe(true);
    expect(label()?.textContent).toBe('Drop to replace');
    fireOn(at('0.0'), 'dragover', transfer([png()]));
    expect(at('0.1').hasAttribute(EDIT_DROP_REPLACE_ATTR)).toBe(false);
    expect(label()).toBeNull();

    fireOn(at('0.1'), 'dragover', transfer([png()]));
    fireOn(at('0.1'), 'dragleave', transfer([png()]), { relatedTarget: null });
    expect(at('0.1').hasAttribute(EDIT_DROP_REPLACE_ATTR)).toBe(false);

    fireOn(at('0.1'), 'dragover', transfer([png()]));
    fireOn(at('0.1'), 'drop', transfer([png()]));
    expect(at('0.1').hasAttribute(EDIT_DROP_REPLACE_ATTR)).toBe(false);
    expect(label()).toBeNull();
  });

  it('a drag that carries no file marks nothing', () => {
    const { at } = mount(IMG_SRC);
    fireOn(at('0.1'), 'dragover', { types: ['text/plain'], items: [], files: [] });
    expect(at('0.1').hasAttribute(EDIT_DROP_REPLACE_ATTR)).toBe(false);
  });

  it('leaving edit mode takes the mark with it', () => {
    const { session, at } = mount(IMG_SRC);
    fireOn(at('0.1'), 'dragover', transfer([png()]));
    session.dispose();
    expect(at('0.1').hasAttribute(EDIT_DROP_REPLACE_ATTR)).toBe(false);
    expect(label()).toBeNull();
    fireEvent.doubleClick(at('0.1'));
    expect(sent(STORY_IMAGE_REPLACE_MESSAGE)).toHaveLength(0);
  });
});
