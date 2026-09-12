/**
 * WHAT IS SELECTED, AND WHAT IS UNDER THE POINTER. A focused host, a clicked
 * container, a component, the words inside a range, a breadcrumb click from
 * the parent — plus the hover boundary and the keys that act on the selection.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import {
  STORY_EDIT_KEY_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_SELECT_MESSAGE,
  type StoryEditParentMessage,
} from '@/lib/story-runtime/contract';
import { EDIT_SELECTED_ATTR, EDIT_EMBED_SELECTED_ATTR, EDIT_HOVER_ATTR } from '@/lib/story-runtime/edit/session';
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
  it('keeps amber feedback visible on a focused editable heading', () => {
    const { at } = mount();
    const heading = at('0.0');
    heading.focus();
    fireEvent.pointerOver(heading);
    expect(window.getComputedStyle(heading).outline).toBe('1px solid rgba(245, 158, 11, 0.9)');
    fireEvent.pointerOut(heading, { relatedTarget: document.body });
    expect(window.getComputedStyle(heading).outline).toBe('1px solid rgba(245, 158, 11, 0.85)');
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
