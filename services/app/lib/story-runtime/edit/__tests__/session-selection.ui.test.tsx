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
    fireEvent.focus(at('0.0'));
    const reported = (last(STORY_SELECTION_MESSAGE) as { selection: Record<string, unknown> }).selection;
    expect(reported.path).toBe('0.0');
    expect(reported.quote).toBeUndefined();
    expect(reported.range).toBeUndefined();
  });

  it('does not select a container when its padding is clicked: its grip, Esc or the breadcrumb do', () => {
    const { at } = mount();
    fireEvent.click(at('0.2'), { bubbles: true });
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: null });
    expect(document.querySelectorAll(`[${EDIT_SELECTED_ATTR}]`)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Delete selected block' })).toBeNull();
  });

  it('marks a selected COMPONENT with its own attribute', () => {
    const { at } = mount('<div className="p-8"><p>text</p><Question data="$q" /></div>');
    fireEvent.click(at('0.1'), { bubbles: true });
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { kind: 'embed', tag: 'Question' } });
    expect(at('0.1').hasAttribute(EDIT_EMBED_SELECTED_ATTR)).toBe(true);
    expect(at('0.1').hasAttribute(EDIT_SELECTED_ATTR)).toBe(false);
    expect(screen.getByRole('button', { name: 'Delete selected block' })).toBeVisible();
  });

  it('clears the selection when the click lands on nothing', () => {
    const { session } = mount();
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: '0.2' } as StoryEditParentMessage);
    fireEvent.click(document.body, { bubbles: true });
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: null });
    expect(document.querySelectorAll(`[${EDIT_SELECTED_ATTR}]`)).toHaveLength(0);
  });

  it('IGNORES a click in the deck rail — its previews are copies of the slides', () => {
    const { session } = mount();
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: '0.2' } as StoryEditParentMessage);
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
    expect(screen.getByRole('button', { name: 'Delete selected block' })).toBeVisible();
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: null } as StoryEditParentMessage);
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: null });
  });
});

describe('typing and block selection', () => {
  const NEUTRAL_SELECTED = '1px solid rgba(100, 116, 139, 0.55)';
  const boxOf = (el: Element) => {
    const style = window.getComputedStyle(el);
    // No rule computes as '' and a focused host's own reset as 'none': both draw nothing.
    return { outline: /solid/.test(style.outline) ? style.outline : 'none', background: style.backgroundColor };
  };
  const CLEAR = 'rgba(0, 0, 0, 0)';
  const NO_BOX = { outline: 'none', background: CLEAR };
  const grip = () => screen.queryByRole('button', { name: 'Drag block', hidden: true });
  const noBoxAnywhere = () =>
    [...document.querySelectorAll('[data-mx-ast]')].forEach((el) => expect(boxOf(el), el.getAttribute('data-mx-ast')!).toEqual(NO_BOX));
  const escape = (target: Element | Document = document.activeElement ?? document) => fireEvent.keyDown(target, { key: 'Escape' });
  const CARD = '<div className="p-8"><p>text</p><div className="card p-4"><p>inside</p></div><Question data="$q" /></div>';

  it('moving the pointer draws no outline anywhere, only one grip beside the innermost block', () => {
    const { at } = mount(CARD);
    for (const path of ['0.1.0', '0.1', '0.2', '0.0']) {
      fireEvent.pointerOver(at(path));
      noBoxAnywhere();
      expect(document.querySelectorAll('[data-mx-hover-grip]')).toHaveLength(1);
      expect(grip()).toBeVisible();
    }
  });

  it('the cursor says what a click does: pointer over a chart, default over a container, text over text', () => {
    const { at } = mount(CARD);
    fireEvent.pointerOver(at('0.2'));
    expect(getComputedStyle(at('0.2')).cursor).toBe('pointer');
    fireEvent.pointerOver(at('0.1'));
    expect(getComputedStyle(at('0.1')).cursor).toBe('default');
    fireEvent.pointerOver(at('0.1.0'));
    expect(getComputedStyle(at('0.1.0')).cursor).not.toMatch(/pointer|default/);
  });

  it('clicking into text shows the caret only: no outline, no handles, just the grip of that block', () => {
    const { at } = mount();
    fireEvent.click(at('0.1'), { bubbles: true });
    fireEvent.focus(at('0.1'));
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { kind: 'text', path: '0.1', mode: 'typing' } });
    noBoxAnywhere();
    expect(screen.queryByRole('button', { name: 'Delete selected block' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Resize/ })).toBeNull();
    // No hover (a touch screen): the grip belongs to the block with the caret.
    expect(grip()).toBeVisible();
  });

  it('pressing the grip selects its block and drops the caret; the block shows its outline and handles', () => {
    const { at } = mount();
    const host = at('0.1');
    host.focus();
    window.getSelection()!.setBaseAndExtent(host.firstChild!, 1, host.firstChild!, 1);
    fireEvent.pointerOver(host);
    // Pressing the grip starts a drag, which asks what is under the pointer; jsdom has no layout.
    const elementFromPoint = document.elementFromPoint;
    document.elementFromPoint = () => host;
    try {
      fireEvent.pointerDown(grip()!, { pointerId: 1 });
      fireEvent.pointerUp(document, { pointerId: 1 });
    } finally {
      document.elementFromPoint = elementFromPoint;
    }
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { path: '0.1', mode: 'block' } });
    expect(window.getSelection()!.rangeCount).toBe(0);
    expect(document.activeElement).not.toBe(host);
    expect(boxOf(host)).toEqual({ outline: NEUTRAL_SELECTED, background: CLEAR });
    expect(screen.getByRole('button', { name: 'Delete selected block' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Resize selected block' })).toBeVisible();
    // One grip: the selected block's own.
    expect(grip()).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Move selected block' })).toBeVisible();
    fireEvent.focus(host);
    expect(screen.queryByRole('button', { name: 'Delete selected block' })).toBeNull();
    expect(boxOf(host)).toEqual(NO_BOX);
  });

  it('Esc climbs from the caret block through its containers, then clears; only then does Esc reach the parent', () => {
    const { at } = mount('<div className="p-8"><section className="card p-4"><div className="cell p-2"><p>deep</p></div><p>other</p></section></div>');
    at('0.0.0.0').focus();
    fireEvent.focus(at('0.0.0.0'));
    const climb = ['0.0.0.0', '0.0.0', '0.0'];
    for (const path of climb) {
      escape();
      expect(last(STORY_SELECTION_MESSAGE), path).toMatchObject({ selection: { path } });
      expect(screen.getByRole('button', { name: 'Delete selected block' })).toBeVisible();
    }
    escape();
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: null });
    expect(sent(STORY_EDIT_KEY_MESSAGE)).toHaveLength(0);
    escape();
    expect(last(STORY_EDIT_KEY_MESSAGE)).toMatchObject({ key: 'Escape' });
  });

  it('keeps focus inside the document root in block mode, so the next Esc and Delete still arrive', () => {
    const { at, root } = mount('<div className="p-8"><section className="card p-4"><p>deep</p><p>other</p></section></div>', undefined, { root: true });
    at('0.0.0').focus();
    fireEvent.focus(at('0.0.0'));
    escape(at('0.0.0'));
    expect(document.activeElement).toBe(root);
    escape();
    expect(last(STORY_SELECTION_MESSAGE)).toMatchObject({ selection: { path: '0.0' } });
    fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    expect(last(STORY_EDIT_KEY_MESSAGE)).toMatchObject({ key: 'Delete' });
  });

  it('leaves Esc to a dialog open in the document', () => {
    const { at } = mount('<div className="p-8"><div role="dialog"><p>inside a dialog</p></div></div>');
    at('0.0.0').focus();
    fireEvent.focus(at('0.0.0'));
    const before = env.posted.length;
    escape(at('0.0.0'));
    expect(env.posted).toHaveLength(before);
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

  it('puts the grip of a table cell beside the table: a cell is text, the table is the block', () => {
    const { at } = mount('<div className="p-8"><table><tbody><tr><td>January</td><td>120</td></tr></tbody></table></div>');
    const table = at('0.0');
    table.getBoundingClientRect = () => new DOMRect(200, 300, 400, 80);
    fireEvent.pointerOver(at('0.0.0.0.0'));
    noBoxAnywhere();
    expect(grip()!.parentElement).toHaveStyle({ left: '176px', top: '300px' });
  });

  it('keeps the hover while the pointer travels onto the grip', () => {
    const { at } = mount();
    fireEvent.pointerOver(at('0.1'));
    fireEvent.pointerOut(at('0.1'), { relatedTarget: grip() });
    fireEvent.pointerOver(grip()!);
    expect(at('0.1').hasAttribute(EDIT_HOVER_ATTR)).toBe(true);
    expect(grip()).toBeVisible();
  });

  it('shows no hover grip while a block is selected: its own grip is the only one', () => {
    const { session, at } = mount();
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: '0.2' } as StoryEditParentMessage);
    fireEvent.pointerOver(at('0.1'));
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
    const { session } = mount('<div className="p-8"><p className="lede">static</p><p className={row.tone}>computed</p></div>');
    const select = (path: string) => session.onParentMessage({ type: STORY_SELECT_MESSAGE, path } as StoryEditParentMessage);
    select('0.0');
    expect(screen.getByRole('button', { name: 'Resize selected block' })).toBeVisible();
    select('0.1');
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
    const { session } = mount();
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: '0.2' } as StoryEditParentMessage);
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(last(STORY_EDIT_KEY_MESSAGE)).toMatchObject({ key: 'Delete' });
  });

  it('leaves Delete alone while a text host has focus — those keys are the text\'s', () => {
    const { session, at } = mount();
    session.onParentMessage({ type: STORY_SELECT_MESSAGE, path: '0.2' } as StoryEditParentMessage);
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

  it('forwards Escape when nothing is selected', () => {
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
