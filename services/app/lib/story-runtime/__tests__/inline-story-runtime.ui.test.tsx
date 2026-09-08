import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { InlineStoryRuntime, type InlineStoryController } from '../InlineStoryRuntime';
import { STORY_DOCUMENT_MESSAGE, STORY_EDIT_MODE_MESSAGE, type StoryIslandData } from '../contract';

afterEach(cleanup);
const data = (label: string): StoryIslandData => {
  const parsed = parseJsx(`<h1 id="heading" aria-label="Artifact heading">${label}</h1>`);
  if (!parsed.ok) throw new Error(parsed.error);
  return { nodes: parsed.nodes, colorMode: 'light', refData: {}, chrome: false };
};
const transport = { run: vi.fn(async () => ({ tables: {}, errors: {} })), page: vi.fn(async () => ({ rows: [], columns: [] })) };

describe('inline artifact runtime lifetime', () => {
  it('renders directly in the main document and adopts versions without replacing its root', async () => {
    let session: InlineStoryController | null = null;
    const view = render(<InlineStoryRuntime data={data('First')} transport={transport} onController={value => { session = value; }} />);
    await waitFor(() => expect(session).not.toBeNull());
    const heading = screen.getByLabelText('Artifact heading');
    expect(heading.getRootNode()).toBe(document);
    expect(view.container.querySelector('iframe')).toBeNull();
    const parent = heading.parentElement;
    await act(async () => { session!.update({ type: STORY_DOCUMENT_MESSAGE, nodes: data('Second').nodes }); });
    expect(screen.getByLabelText('Artifact heading')).toHaveTextContent('Second');
    expect(screen.getByLabelText('Artifact heading').parentElement).toBe(parent);
  });

  it('accepts editing through its private endpoint, never forged window messages, and revokes the endpoint on unmount', async () => {
    let session: InlineStoryController | null = null;
    const callback = (value: InlineStoryController | null) => { session = value; };
    const view = render(<InlineStoryRuntime data={data('First')} transport={transport} onController={callback} />);
    await waitFor(() => expect(session).not.toBeNull());
    await act(async () => { window.dispatchEvent(new MessageEvent('message', { data: { type: STORY_EDIT_MODE_MESSAGE, on: true }, source: window })); });
    expect(screen.getByLabelText('Artifact heading')).not.toHaveAttribute('contenteditable', 'true');
    await act(async () => { session!.send({ type: STORY_EDIT_MODE_MESSAGE, on: true }); });
    await waitFor(() => expect(screen.getByLabelText('Artifact heading')).toHaveAttribute('contenteditable', 'true'));
    const old = session!;
    const listener = vi.fn();
    old.subscribe(listener);
    view.unmount();
    expect(session).toBeNull();
    listener.mockClear();
    old.send({ type: STORY_EDIT_MODE_MESSAGE, on: true });
    old.update({ type: STORY_DOCUMENT_MESSAGE, nodes: data('Stale').nodes });
    expect(listener).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="Artifact heading"]')).toBeNull();
  });
});
