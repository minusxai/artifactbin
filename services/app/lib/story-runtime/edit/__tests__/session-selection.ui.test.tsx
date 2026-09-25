/**
 * WHAT IS SELECTED, AND WHAT IS UNDER THE POINTER. A focused host, a clicked
 * container, a component, the words inside a range, a breadcrumb click from
 * the parent — plus the hover boundary and the keys that act on the selection.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import {
  STORY_BLOCK_EDIT_MESSAGE,
  STORY_EDIT_KEY_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_SELECT_MESSAGE,
  STORY_SPOTLIGHT_MESSAGE,
  type StoryEditParentMessage,
} from '@/lib/story-runtime/contract';
import { EDIT_SELECTED_ATTR, EDIT_EMBED_SELECTED_ATTR, EDIT_HOVER_ATTR, EDIT_SPOTLIGHT_ATTR } from '@/lib/story-runtime/edit/session';
import {
  disposeEditSessions,
  env,
  installEditSession,
  last,
  mount,
  sent,
} from '@/test/helpers/edit-session';

beforeEach(installEditSession);
afterEach(disposeEditSessions);

describe('selection', () => {
  it('reports a focused text host', () => {
    const { at } = mount();
    fireEvent.focus(at('0.1'));
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({
      selection: { kind: 'text', path: '0.1', tag: 'p', className: 'lede' },
    });
  });

  /*
   * The editor's own "Comment on selection" and the view-mode
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
    const before = env.posted.length;
    const rail = document.createElement('nav');
    rail.className = 'mx-rail';
    rail.innerHTML = '<p data-mx-ast="0.1">a preview copy</p>';
    document.body.appendChild(rail);
    fireEvent.click(rail.querySelector('p')!, { bubbles: true });
    expect(env.posted).toHaveLength(before);
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
  const NEUTRAL_HOVER = '1px solid rgba(100, 116, 139, 0.28)';
  const NEUTRAL_SELECTED = '1px solid rgba(100, 116, 139, 0.55)';
  const boxOf = (el: Element) => {
    const style = window.getComputedStyle(el);
    // No rule computes as '' and a focused host's own reset as 'none': both draw nothing.
    return { outline: /solid/.test(style.outline) ? style.outline : 'none', background: style.backgroundColor };
  };
  const CLEAR = 'rgba(0, 0, 0, 0)';
  const NO_BOX = { outline: 'none', background: CLEAR };
  const grip = () => screen.queryByRole('button', { name: 'Drag block', hidden: true });

  it('draws no box on a text host, hovered or focused: the caret is the indicator', () => {
    const { at } = mount();
    const heading = at('0.0');
    heading.focus();
    fireEvent.pointerOver(heading);
    expect(boxOf(heading)).toEqual(NO_BOX);
    fireEvent.pointerOut(heading, { relatedTarget: document.body });
    expect(heading.hasAttribute(EDIT_SELECTED_ATTR)).toBe(true);
    expect(boxOf(heading)).toEqual(NO_BOX);
  });

  it('outlines a hovered non-text block faintly in neutral grey, with no fill', () => {
    const { at } = mount('<div className="p-8"><p>text</p><div className="card p-4"><p>inside</p></div></div>');
    fireEvent.pointerOver(at('0.1'));
    expect(boxOf(at('0.1'))).toEqual({ outline: NEUTRAL_HOVER, background: CLEAR });
  });

  it('reacts only for the innermost hovered thing: text in a card shows nothing for the card', () => {
    const { at } = mount('<div className="p-8"><p>text</p><div className="card p-4"><p>inside</p></div></div>');
    fireEvent.pointerOver(at('0.1.0'));
    expect(document.querySelectorAll(`[${EDIT_HOVER_ATTR}]`)).toHaveLength(1);
    expect(boxOf(at('0.1'))).toEqual(NO_BOX);
    expect(boxOf(at('0.1.0'))).toEqual(NO_BOX);
    fireEvent.pointerOver(at('0.1'));
    expect(boxOf(at('0.1'))).toEqual({ outline: NEUTRAL_HOVER, background: CLEAR });
    expect(boxOf(at('0.1.0'))).toEqual(NO_BOX);
  });

  it('treats controls as blocks even when their label is editable text', () => {
    const { at } = mount('<div className="p-8"><button>Go</button><a href="https://example.com">Docs</a></div>');
    fireEvent.pointerOver(at('0.0'));
    expect(boxOf(at('0.0'))).toEqual({ outline: NEUTRAL_HOVER, background: CLEAR });
    fireEvent.pointerOver(at('0.1'));
    expect(boxOf(at('0.1'))).toEqual({ outline: NEUTRAL_HOVER, background: CLEAR });
  });

  it('outlines a selected non-text block solidly in neutral grey, and never a selected text host', () => {
    const { at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    expect(boxOf(at('0.2'))).toEqual({ outline: NEUTRAL_SELECTED, background: CLEAR });
    fireEvent.pointerOver(at('0.2'));
    expect(boxOf(at('0.2'))).toEqual({ outline: NEUTRAL_SELECTED, background: CLEAR });
    fireEvent.click(at('0.1'), { bubbles: true });
    expect(at('0.1').hasAttribute(EDIT_SELECTED_ATTR)).toBe(true);
    expect(boxOf(at('0.1'))).toEqual(NO_BOX);
  });

  it('puts a drag grip in the left margin of the hovered block, and only there', () => {
    const { at } = mount('<div className="p-8"><p>text</p><div className="card p-4"><p>inside</p></div></div>');
    const inside = at('0.1.0');
    inside.getBoundingClientRect = () => new DOMRect(100, 200, 300, 24);
    fireEvent.pointerOver(inside);
    const handle = grip()!;
    expect(handle).toBeVisible();
    const box = handle.parentElement!;
    expect(Number.parseFloat(box.style.left) + Number.parseFloat(handle.style.width || '0')).toBeLessThanOrEqual(100);
    expect(box.style.top).toBe('200px');
    fireEvent.pointerOut(inside, { relatedTarget: document.body });
    expect(grip()).not.toBeVisible();
  });

  it('keeps the hover while the pointer travels onto the grip', () => {
    const { at } = mount();
    fireEvent.pointerOver(at('0.1'));
    fireEvent.pointerOut(at('0.1'), { relatedTarget: grip() });
    fireEvent.pointerOver(grip()!);
    expect(at('0.1').hasAttribute(EDIT_HOVER_ATTR)).toBe(true);
    expect(grip()).toBeVisible();
  });

  it('hides the margin grip on the selected block, which has its own', () => {
    const { at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    fireEvent.pointerOver(at('0.2'));
    expect(grip()).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Move selected block' })).toBeVisible();
  });

  it('dragging the grip selects its block and moves it', () => {
    const { at } = mount();
    const pointer = (type: string, target: EventTarget, x: number) =>
      target.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { pointerId: 1, clientX: x, clientY: 10 }));
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => at('0.2');
    try {
      fireEvent.pointerOver(at('0.1'));
      pointer('pointerdown', grip()!, 10);
      expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { path: '0.1' } });
      pointer('pointermove', document, 60);
      pointer('pointerup', document, 60);
    } finally {
      document.elementFromPoint = elementFromPoint;
    }
    expect(last(STORY_BLOCK_EDIT_MESSAGE)).toMatchObject({ command: { kind: 'move', path: '0.1', target: '0.2' } });
  });

  it('offers resize dots only when the selected block can be resized', () => {
    const { at } = mount('<div className="p-8"><p className="lede">static</p><p className={row.tone}>computed</p></div>');
    fireEvent.click(at('0.0'), { bubbles: true });
    expect(screen.getByRole('button', { name: 'Resize selected block' })).toBeVisible();
    fireEvent.click(at('0.1'), { bubbles: true });
    expect(screen.getByRole('button', { name: 'Move selected block' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete selected block' })).toBeVisible();
    for (const name of ['Resize selected block', 'Resize block width', 'Resize block height'])
      expect(screen.queryByRole('button', { name })).toBeNull();
  });

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

/**
 * A SPOTLIGHT is the parent pointing at nodes without selecting them (the
 * query notebook naming what a query powers): an outline attribute, no
 * selection report, the whole set each time, [] to clear.
 */
describe('spotlight', () => {
  it('spotlights nodes by path when the parent asks — no selection — and clears on []', () => {
    const { session, at } = mount();
    const selections = sent(STORY_SELECTION_MESSAGE).length;
    session.onParentMessage({ type: STORY_SPOTLIGHT_MESSAGE, paths: ['0.1', '0.2', '9.9'] } as StoryEditParentMessage);
    expect(at('0.1').hasAttribute(EDIT_SPOTLIGHT_ATTR)).toBe(true);
    expect(at('0.2').hasAttribute(EDIT_SPOTLIGHT_ATTR)).toBe(true);
    expect(at('0.1').hasAttribute(EDIT_SELECTED_ATTR)).toBe(false);
    expect(sent(STORY_SELECTION_MESSAGE)).toHaveLength(selections);
    session.onParentMessage({ type: STORY_SPOTLIGHT_MESSAGE, paths: ['0.0'] } as StoryEditParentMessage);
    expect(at('0.1').hasAttribute(EDIT_SPOTLIGHT_ATTR)).toBe(false);
    expect(at('0.0').hasAttribute(EDIT_SPOTLIGHT_ATTR)).toBe(true);
    session.onParentMessage({ type: STORY_SPOTLIGHT_MESSAGE, paths: [] } as StoryEditParentMessage);
    expect(document.querySelector(`[${EDIT_SPOTLIGHT_ATTR}]`)).toBeNull();
  });
});
