/**
 * GOING IN, AND TYPING. What edit mode turns on, what it leaves alone, and the
 * one rule the commit path rests on: a text edit is sent when the USER typed
 * it, once, and never for a render that merely changed the content.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent } from '@testing-library/react';
import {
  STORY_EDIT_READY_MESSAGE,
  STORY_TEXT_EDIT_MESSAGE,
  STORY_TYPING_MESSAGE,
} from '@/lib/story-runtime/contract';
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

describe('createFrameEditSession — going in', () => {
  it('preserves cross-region selection when refreshed nodes have identical content', () => {
    const source = '<div><p>first</p></div><div><p>second</p></div>';
    const { session, at } = mount(source);
    at('0').classList.add('ProseMirror');
    at('1').classList.add('ProseMirror');
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(at('0.0').firstChild!, 1, at('1.0').firstChild!, 3);
    fireEvent(document, new Event('selectionchange'));
    expect(document.querySelectorAll('[data-mx-block-selected]')).toHaveLength(2);
    session.setNodes(nodesOf(source));
    expect(document.querySelectorAll('[data-mx-block-selected]')).toHaveLength(2);
    expect(document.querySelector<HTMLElement>('[data-mx-block-status]')!.style.display).toBe('block');
    session.setNodes(nodesOf('<p>different document</p>'));
    expect(document.querySelectorAll('[data-mx-block-selected]')).toHaveLength(0);
    selection.removeAllRanges();
  });

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
    expect(env.posted.length).toBeGreaterThan(2);
    expect(env.posted.every((m) => m.nonce === NONCE)).toBe(true);
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
