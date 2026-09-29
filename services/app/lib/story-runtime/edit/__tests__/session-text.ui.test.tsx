/**
 * GOING IN, AND TYPING. What edit mode turns on, what it leaves alone, and the
 * one rule the commit path rests on: a text edit is sent when the USER typed
 * it, once, and never for a render that merely changed the content.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { renderStoryNodes } from '@/lib/story-ui/interpreter';
import { createFrameEditSession } from '@/lib/story-runtime/edit/session';
import { mountCompiledEditRegions } from '@/solid/editor/dom-mounter';
import {
  STORY_EDIT_READY_MESSAGE,
  STORY_TEXT_EDIT_MESSAGE,
  STORY_TYPING_MESSAGE,
  STORY_COMMIT_MESSAGE,
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
  it('restores the text selection when a draft remount follows a typography toolbar action', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    root.innerHTML = '<p id="first" data-mx-ast="0">alpha</p>';
    const toolbar = document.body.appendChild(document.createElement('div'));
    toolbar.setAttribute('aria-label', 'Typography toolbar');
    const action = toolbar.appendChild(document.createElement('button'));
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    const session = createFrameEditSession({ win: window, root, channel: env.channel, requestRender: () => {}, mountCompiled: mountCompiledEditRegions });
    session.setNodes(nodesOf('<p id="first">alpha</p>'));
    await session.mountCompiledDom();
    root.querySelector<HTMLElement>('.ProseMirror')!.focus();
    action.focus();
    session.unmountCompiledDom();
    root.innerHTML = '<p id="first" data-mx-ast="0">alpha</p>';
    await session.mountCompiledDom();
    await waitFor(() => expect(document.activeElement).toHaveClass('ProseMirror'));
    session.dispose(); toolbar.remove(); root.remove();
  });

  it('keeps an undo bookmark across the compiled DOM replacement', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    root.innerHTML = '<p id="first" data-mx-ast="0">alXvo second paragraph</p>';
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(0), 0));
    const session = createFrameEditSession({ win: window, root, channel: env.channel, requestRender: () => {}, mountCompiled: mountCompiledEditRegions });
    session.setNodes(nodesOf('<p id="first">alXvo second paragraph</p>'));
    await session.mountCompiledDom();
    root.querySelector<HTMLElement>('.ProseMirror')!.focus();
    session.onParentMessage({ type: STORY_COMMIT_MESSAGE,
      restore: { anchor: { id: 'first', offset: 2 }, head: { id: 'second', offset: 3 } } });
    session.unmountCompiledDom();
    root.innerHTML = '<p id="first" data-mx-ast="0">alpha first paragraph</p><p id="second" data-mx-ast="1">bravo second paragraph</p>';
    session.setNodes(nodesOf('<p id="first">alpha first paragraph</p><p id="second">bravo second paragraph</p>'));
    await session.mountCompiledDom();
    const selection = window.getSelection()!;
    await waitFor(() => expect(selection.anchorNode?.parentElement?.closest('p')?.id).toBe('first'));
    expect(selection.focusNode?.parentElement?.closest('p')?.id).toBe('second');
    session.dispose();
    root.remove();
  });
  it('restores the reader scroll after compiled prose is mounted', async () => {
    const root = document.body.appendChild(document.createElement('div'));
    let scrollY = 806;
    vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((_x, y) => { scrollY = Number(y); });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    const session = createFrameEditSession({ win: window, root, channel: env.channel, requestRender: () => {},
      mountCompiled: () => { scrollY = 0; return { dispose() {} }; } });
    session.setNodes(nodesOf('<p>Reader paragraph</p>'));
    await session.mountCompiledDom();
    expect(scrollTo).toHaveBeenCalledWith(0, 806);
    session.dispose();
  });
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

  it('keeps committed text visible through a composer render until the source update arrives', () => {
    const { at, view, session, nodes } = mount();
    const host = at('0.1');
    fireEvent.focus(host);
    host.innerHTML = 'hello MIDSENTENCE';
    fireEvent.input(host);
    fireEvent.blur(host);
    view.rerender(<>{renderStoryNodes(nodes, { components: {}, decorateElement: session.decorate })}</>);
    expect(at('0.1').textContent).toBe('hello MIDSENTENCE');
    expect(last(STORY_TEXT_EDIT_MESSAGE)).toMatchObject({ innerHtml: 'hello MIDSENTENCE' });
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
