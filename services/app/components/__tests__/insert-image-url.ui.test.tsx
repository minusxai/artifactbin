/**
 * Insert image FROM A URL — the human half of web importing. The button that
 * used to be only a file picker opens a small popover with both ways in;
 * pasting a URL posts `imageUrl` to the browser's own create door (the same
 * ingest-and-own path the agent door runs) and inserts `ref:<id>` into the
 * source. A refusal SHOWS — the door's whole point is naming what failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const queue = vi.fn();
const flushNow = vi.fn(async () => {});
vi.mock('@/lib/story/use-live-edits', () => ({
  FLUSH_DEBOUNCE_MS: 500,
  useLiveEdits: () => ({
    state: { version: 4, editId: 'e1', status: '', pending: false },
    queue, flushNow, adoptRemote: vi.fn(() => false), isOwnEdit: () => false,
  }),
}));
vi.mock('@/lib/story/use-live-artifact', () => ({ useLiveArtifact: () => null }));

import InPlaceEditor from '../InPlaceEditor';

const NONCE = 'a'.repeat(32);
const SOURCE = '<div data-design="tw" className="p-4"><h1 id="h">Title</h1></div>';

const art = {
  id: 'doc1', version: 4, edit_id: 'e1',
  title: 'doc', theme: null, template: null, colorMode: 'light',
  markup: SOURCE, refs: [], compiledCss: '.x{}', dataflow: null,
};

let frameEl: HTMLIFrameElement;

/**
 * Mounting the editor reads its version history, so `fetch` must answer for
 * the whole file: a relative URL reaching the real fetch rejects UNHANDLED,
 * which leaves every test green and the run failed.
 */
const stubFetch = (create: Response) =>
  vi.spyOn(global, 'fetch').mockImplementation(async (url) =>
    (String(url).includes('/versions')
      ? new Response(JSON.stringify({ versions: [] }), { status: 200 })
      : create.clone()) as unknown as Response,
  );

beforeEach(() => {
  frameEl = document.createElement('iframe');
  document.body.appendChild(frameEl);
  queue.mockClear();
  stubFetch(new Response(JSON.stringify({ id: 'img000' }), { status: 201 }));
});

afterEach(() => {
  frameEl.remove();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const mount = () =>
  render(
    <InPlaceEditor
      art={art as React.ComponentProps<typeof InPlaceEditor>['art']}
      frameRef={{ current: frameEl }}
      sessionNonce={NONCE}
    />,
  );

describe('insert image from a URL', () => {
  it('offers both ways in behind the one insert-image control', () => {
    mount();
    const trigger = screen.getByLabelText('Insert image');
    expect(trigger).toHaveClass('h-6', 'justify-center');
    expect(trigger).toHaveAttribute('data-slot', 'tooltip-trigger');
    expect(trigger).not.toHaveAttribute('data-tip');
    fireEvent.click(trigger);
    expect(screen.getByLabelText('Image URL')).toBeTruthy();
    expect(screen.getByLabelText('Import image from URL')).toBeTruthy();
    expect(screen.getByLabelText('Upload image file')).toBeTruthy(); // the file path survives
  });

  it('imports the URL through the browser door and inserts the ref it became', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'img999' }), { status: 201 }));
    mount();
    fireEvent.click(screen.getByLabelText('Insert image'));
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/logo.png' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });

    const create = fetchSpy.mock.calls.find(([u, i]) => (i as RequestInit)?.method === 'POST') as [string, RequestInit];
    expect(create[0]).toContain('/api/my/artifacts');
    expect(JSON.parse(String(create[1].body))).toEqual({ imageUrl: 'https://example.com/logo.png' });

    await waitFor(() => expect(queue).toHaveBeenCalled());
    const queued = queue.mock.calls.at(-1)?.[0] as { source?: string };
    expect(queued.source).toContain('ref:img999');
  });

  it('pushes the new image\'s ref WITH the insert — otherwise it renders a broken `ref:` string', async () => {
    // The served document's ref map was built before this image existed, so
    // without the entry the interpreter writes the literal `ref:<id>` into
    // src and the reader sees a 0×0 image until a full reload.
    const posted: Array<Record<string, unknown>> = [];
    Object.defineProperty(frameEl, 'contentWindow', {
      configurable: true,
      value: { postMessage: (m: Record<string, unknown>) => posted.push(m) },
    });
    stubFetch(new Response(JSON.stringify({ id: 'img777', rawUrl: '/a/img777/raw?v=1' }), { status: 201 }));
    mount();
    fireEvent.click(screen.getByLabelText('Insert image'));
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/logo.png' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });

    await waitFor(() => expect(posted.some((m) => m.type === 'mx:document' && m.refData)).toBe(true));
    const update = posted.filter((m) => m.type === 'mx:document' && m.refData).at(-1)!;
    expect(update.refData).toEqual({ img777: { kind: 'image', url: '/a/img777/raw?v=1' } });
  });

  it('shows the door\'s refusal — a dead URL is an error the human reads, not silence', async () => {
    stubFetch(new Response(
      JSON.stringify({ error: 'image_fetch_failed', details: ['https://example.com/gone.png: answered 404'] }),
      { status: 400 },
    ));
    mount();
    fireEvent.click(screen.getByLabelText('Insert image'));
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/gone.png' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });

    await waitFor(() => expect(screen.getByLabelText('Image upload error').textContent).toContain('404'));
    expect(queue).not.toHaveBeenCalled();
  });

  it('does nothing with an empty field', async () => {
    const fetchSpy = stubFetch(new Response('{}', { status: 201 }));
    mount();
    fireEvent.click(screen.getByLabelText('Insert image'));
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });
    // The mount's own reads may fire; an IMPORT (a POST) must not.
    expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'POST')).toBe(false);
  });
});
