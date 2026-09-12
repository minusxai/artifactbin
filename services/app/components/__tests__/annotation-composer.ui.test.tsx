/**
 * THE COMPOSER — what a new comment carries and what it must drop.
 *
 * The selection's quote travels with an anchor-relative range, and both are
 * discarded the moment the thing they describe changes underneath: a different
 * durable node at the same path, a widened target, a removed id. A caret
 * comment carries no quote at all and is still a comment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  STORY_ANNOTATIONS_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_SELECT_MESSAGE,
} from '@/lib/story-runtime/contract';
import {
  NONCE,
  fetchCalls,
  flush,
  fromFrame,
  installAnnotationFetch,
  knobs,
  layer,
  makeFrame,
} from '@/test/helpers/annotation-layer';

beforeEach(installAnnotationFetch);
afterEach(() => vi.unstubAllGlobals());

describe('the annotation composer', () => {
  it('forwards the selection quote and its anchor-relative range in the create POST', async () => {
    const { frame } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'text' as const, path: '1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [],
        quote: 'grew 40% in Q3,',
        range: { v: 1 as const, parts: [
          { rel: '0', start: 8, end: 12, text: 'grew' },
          { rel: '', start: 12, end: 23, text: ' 40% in Q3,' },
        ] },
      },
    }));
    await flush();
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'which quarter?' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toEqual({
      path: '1', node_id: 'node-1', body: 'which quarter?',
      quote: 'grew 40% in Q3,',
      range: { v: 1, parts: [
        { rel: '0', start: 8, end: 12, text: 'grew' },
        { rel: '', start: 12, end: 23, text: ' 40% in Q3,' },
      ] },
    });
  });

  it('keeps the captured words when the frame re-reports the SAME node', async () => {
    const { frame, contentWindow } = makeFrame();
    const quoted = {
      kind: 'text' as const, path: '1', nodeId: 'node-1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [],
      quote: 'grew 40% in Q3,',
      range: { v: 1 as const, parts: [{ rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] },
    };
    render(layer(frame, { railOpen: true, initialSelection: quoted }));
    await flush();
    await fromFrame(contentWindow, {
      type: STORY_SELECTION_MESSAGE, nonce: NONCE,
      selection: { kind: 'text', path: '1', nodeId: 'node-1', tag: 'p', rect: { x: 5, y: 40, width: 200, height: 40 }, className: '', style: '', ancestors: [] },
    });
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'still about those words' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toMatchObject({ quote: quoted.quote, range: quoted.range });
  });

  it('does not inherit a removed target identity into an id-less successor at the same path', async () => {
    const { frame, contentWindow } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'text', path: '1', nodeId: 'old-node', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [],
        quote: 'old words', range: { v: 1, parts: [{ rel: '', start: 0, end: 9, text: 'old words' }] },
      },
    }));
    await flush();
    await fromFrame(contentWindow, {
      type: STORY_SELECTION_MESSAGE, nonce: NONCE,
      selection: { kind: 'text', path: '1', tag: 'p', rect: { x: 5, y: 40, width: 200, height: 40 }, className: '', style: '', ancestors: [] },
    });
    const composer = await screen.findByLabelText('Annotation comment');
    fireEvent.change(composer, { target: { value: 'draft survives replacement' } });
    const before = fetchCalls.length;
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(fetchCalls.slice(before).filter((call) => call.init?.method === 'POST')).toHaveLength(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for this change to save');
    expect(composer).toHaveValue('draft survives replacement');
  });

  it('drops the old quote and range when the same path reports a different durable node', async () => {
    const { frame, contentWindow } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'text', path: '1', nodeId: 'old-node', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [],
        quote: 'old words', range: { v: 1, parts: [{ rel: '', start: 0, end: 9, text: 'old words' }] },
      },
    }));
    await flush();
    await fromFrame(contentWindow, {
      type: STORY_SELECTION_MESSAGE, nonce: NONCE,
      selection: { kind: 'text', path: '1', nodeId: 'new-node', tag: 'p', rect: { x: 5, y: 40, width: 200, height: 40 }, className: '', style: '', ancestors: [] },
    });
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'draft follows explicit target' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((call) => call.url.endsWith('/api/my/artifacts/doc1/annotations') && call.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toEqual({ path: '1', node_id: 'new-node', body: 'draft follows explicit target' });
  });

  it('drops them when the composer is widened to a DIFFERENT node — they no longer describe it', async () => {
    const { frame, contentWindow } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'text' as const, path: '1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [],
        quote: 'grew 40% in Q3,',
        range: { v: 1 as const, parts: [{ rel: '', start: 12, end: 23, text: ' 40% in Q3,' }] },
      },
    }));
    await flush();
    await fromFrame(contentWindow, {
      type: STORY_SELECTION_MESSAGE, nonce: NONCE,
      selection: { kind: 'element', path: '0', nodeId: 'node-0', tag: 'section', rect: { x: 0, y: 0, width: 400, height: 90 }, className: '', style: '', ancestors: [] },
    });
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'about the whole section' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toEqual({ path: '0', node_id: 'node-0', body: 'about the whole section' });
  });

  it('sends no quote for a selection that has none — a caret comment is still a comment', async () => {
    const { frame } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: { kind: 'text' as const, path: '1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [] },
    }));
    await flush();
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'no words' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toEqual({ path: '1', node_id: 'node-1', body: 'no words' });
  });

  it('a handed-in selection opens an anchored page composer; save moves the comment to the rail', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'element' as const, path: '2.1', tag: 'div', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
        ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }],
      },
    }));
    await flush();

    const composer = await screen.findByLabelText('Annotation comment');
    const popover = screen.getByRole('dialog', { name: 'Annotation composer' });
    expect(popover).toHaveClass('fixed');
    // The frame is full-width under an open rail, so the composer is kept
    // clear of the rail's 320px: 800 - 320 - 12 - 384 = 84, not the 217 the
    // selection alone would ask for.
    expect(popover.style.left).toBe('84px');
    expect(Number.parseInt(popover.style.left, 10) + Number.parseInt(popover.style.width, 10)).toBeLessThanOrEqual(800 - 320);
    expect(popover.style.top).toBe('158px'); // frame top + selection y + selection height + 12px
    expect(within(screen.getByLabelText('Annotation sidebar')).queryByLabelText('Annotation comment')).toBeNull();
    // The breadcrumb: the ancestor is clickable and asks the FRAME to re-select.
    fireEvent.click(screen.getByLabelText('Select section'));
    const selects = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_SELECT_MESSAGE);
    expect(selects.at(-1)).toMatchObject({ path: '2' });

    fireEvent.change(composer, { target: { value: 'fresh note' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    const create = fetchCalls.find((c) => c.url.endsWith('/api/my/artifacts/doc1/annotations') && c.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toMatchObject({ path: '2.1', node_id: 'node-2-1', body: 'fresh note' });
    const clears = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_SELECT_MESSAGE);
    expect(clears.at(-1)).toMatchObject({ path: null });
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    expect(screen.getAllByLabelText('Annotation thread').some((thread) => thread.textContent?.includes('fresh note'))).toBe(true);
  });

  it('submits the composer with command-enter and gives only Comment the filled treatment', async () => {
    const { frame } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: { kind: 'text' as const, path: '0', tag: 'p', rect: { x: 0, y: 0, width: 100, height: 20 }, className: '', style: '', ancestors: [] },
    }));
    await flush();

    const composer = await screen.findByLabelText('Annotation comment');
    const cancel = screen.getByLabelText('Cancel annotation');
    const comment = screen.getByLabelText('Save annotation');
    expect(cancel).toHaveClass('bg-transparent');
    expect(cancel).not.toHaveClass('border');
    expect(comment).toHaveClass('border-accent', 'bg-accent', 'text-bg');

    fireEvent.change(composer, { target: { value: 'from the keyboard' } });
    fireEvent.keyDown(composer, { key: 'Enter', metaKey: true });
    await flush();
    const create = fetchCalls.find((call) => call.url.endsWith('/api/my/artifacts/doc1/annotations') && call.init?.method === 'POST');
    expect(JSON.parse(String(create!.init!.body))).toMatchObject({ body: 'from the keyboard' });
  });

  it('opens the composer on a text selection handed in from view mode', async () => {
    const { frame, postMessage } = makeFrame();
    const initialSelection = {
      kind: 'text' as const, path: '2.1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
      ancestors: [{ path: '2', tag: 'section', hint: 'max-w-2xl' }],
    };
    render(layer(frame, { railOpen: true, initialSelection }));
    expect(await screen.findByLabelText('Annotation comment')).toBeTruthy();
    await flush();
    const messages = postMessage.mock.calls.map((call) => call[0]).filter((message) => message?.type === STORY_ANNOTATIONS_MESSAGE);
    expect(messages.at(-1)).toMatchObject({ mode: 'on', selectedPath: '2.1' });
  });

  it('shows the anchor edit refusal instead of silently swallowing it', async () => {
    knobs.refuseCreate = true;
    const { frame } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: { kind: 'element' as const, path: '0', tag: 'p', rect: { x: 0, y: 0, width: 100, height: 20 }, className: '', style: '', ancestors: [] },
    }));
    await flush();
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'note' } });
    fireEvent.click(screen.getByLabelText('Save annotation'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('invalid_jsx');
    expect(alert.textContent).toContain('Inline style');
    expect(screen.getByLabelText('Annotation comment')).toBeTruthy();
  });

  it('escape cancels the draft, like the cancel button', async () => {
    const { frame, postMessage } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'text' as const, path: '2.1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
        ancestors: [{ path: '2', tag: 'section', hint: '' }],
      },
    }));
    await flush();
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'never mind' } });

    fireEvent.keyDown(window, { key: 'Escape' });
    await flush();
    expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull();
    // …and it clears the document's composing outline, exactly as cancel does.
    const selects = postMessage.mock.calls.map((c) => c[0]).filter((m) => m?.type === STORY_SELECT_MESSAGE);
    expect(selects.at(-1)).toMatchObject({ path: null });
    expect(fetchCalls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('creates a relation directly without a source edit or head retry', async () => {
    const { frame } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'element' as const, path: '2.1', tag: 'div', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '',
        ancestors: [{ path: '2', tag: 'section', hint: '' }],
      },
    }));
    await flush();
    fireEvent.change(await screen.findByLabelText('Annotation comment'), { target: { value: 'mid-sentence note' } });

    const before = fetchCalls.length;
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    await flush();

    const created = fetchCalls.slice(before).find((c) => c.init?.method === 'POST');
    expect(created).toBeTruthy();
    expect(JSON.parse(String(created!.init!.body))).toMatchObject({ node_id: 'node-2-1', body: 'mid-sentence note' });
    expect(String(created!.init!.body)).not.toContain('edit_id');
  });

  it('keeps an unsaved-node draft and asks the user to wait for ordinary autosave', async () => {
    const { frame } = makeFrame();
    render(layer(frame, {
      railOpen: true,
      initialSelection: {
        kind: 'text', path: '2.1', nodeId: undefined, tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [],
      },
    }));
    await flush();
    const composer = await screen.findByLabelText('Annotation comment');
    fireEvent.change(composer, { target: { value: 'keep this draft' } });
    const before = fetchCalls.length;
    fireEvent.click(screen.getByLabelText('Save annotation'));
    await flush();
    expect(fetchCalls).toHaveLength(before);
    expect(screen.getByRole('alert')).toHaveTextContent('Wait for this change to save');
    expect(composer).toHaveValue('keep this draft');
  });
});
