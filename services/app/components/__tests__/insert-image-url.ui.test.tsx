/**
 * Insert image FROM A URL — the human half of web importing. The button opens
 * a small popover with both ways in; pasting a URL posts `imageUrl` to the
 * browser's own create door (the same
 * ingest-and-own path the agent door runs) and inserts `ref:<id>` into the
 * source. A refusal SHOWS — the door's whole point is naming what failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

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
  cleanup();
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
    const trigger = screen.getByRole('button', { name: 'Insert' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(fireEvent.mouseDown(screen.getByLabelText('Image URL'))).toBe(true);
    expect(fireEvent.mouseDown(screen.getByLabelText('Import image from URL'))).toBe(false);
    expect(screen.getByLabelText('Import image from URL')).toBeTruthy();
    expect(screen.getByLabelText('Upload image file')).toBeTruthy(); // the file path survives
  });

  it('imports the URL through the browser door and inserts the ref it became', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'img999' }), { status: 201 }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/logo.png' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });

    const create = fetchSpy.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'POST') as [string, RequestInit];
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
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/gone.png' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });

    await waitFor(() => expect(screen.getByLabelText('Image upload error').textContent).toContain('404'));
    expect(queue).not.toHaveBeenCalled();
  });

  it('does nothing with an empty field', async () => {
    const fetchSpy = stubFetch(new Response('{}', { status: 201 }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });
    // The mount's own reads may fire; an IMPORT (a POST) must not.
    expect(fetchSpy.mock.calls.some(([, i]) => (i as RequestInit)?.method === 'POST')).toBe(false);
  });
});

/**
 * REPLACING AN IMAGE from the editor: every door — the toolbar's Upload file
 * and From URL, a double-click, a drop onto the image, a paste while it is
 * selected — reaches ONE replace. Only `src` changes; the node keeps its id,
 * classes and alt text; the new ref is pushed with it (or it renders as a
 * literal `ref:` string); and one undo brings the old picture back.
 */
describe('replacing an image', () => {
  const IMG_SOURCE = '<div data-design="tw" className="p-4"><h1 id="h">Title</h1>'
    + '<img id="im" src="ref:Old111" alt="A chart" className="my-6 w-1/2 rounded-xl" /></div>';
  const imgArt = { ...art, markup: IMG_SOURCE };
  const IMG_SELECTION = {
    kind: 'element', path: '0.1', tag: 'img', rect: { x: 0, y: 0, width: 10, height: 10 },
    className: 'my-6 w-1/2 rounded-xl', style: '', ancestors: [],
  };

  /** A document that answers every commit request, as the real frame does. */
  let posted: Array<Record<string, unknown>>;
  let frameWin: Window;
  const fromFrame = async (data: Record<string, unknown>) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { nonce: NONCE, ...data }, source: frameWin }));
      await Promise.resolve();
    });
  };
  beforeEach(() => {
    posted = [];
    frameWin = {
      postMessage: (m: Record<string, unknown>) => {
        posted.push(m);
        if (m.type === 'mx:commit' && !m.restore) setTimeout(() => void fromFrame({ type: 'mx:committed' }), 0);
      },
    } as unknown as Window;
    Object.defineProperty(frameEl, 'contentWindow', { configurable: true, value: frameWin });
  });

  const mountImage = async () => {
    const view = render(
      <InPlaceEditor
        art={imgArt as React.ComponentProps<typeof InPlaceEditor>['art']}
        frameRef={{ current: frameEl }}
        sessionNonce={NONCE}
      />,
    );
    await fromFrame({ type: 'mx:selection', selection: IMG_SELECTION });
    return view;
  };
  const lastSource = () => (queue.mock.calls.at(-1)?.[0] as { source?: string }).source ?? '';
  const replaced = (id: string) => IMG_SOURCE.replace('ref:Old111', `ref:${id}`);
  const posts = (spy: ReturnType<typeof stubFetch>) =>
    spy.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'POST') as Array<[string, RequestInit]>;

  it('Replace ▸ From URL swaps only the src, pushes the new ref, and one undo restores the old picture', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'New222', rawUrl: '/a/New222/raw?v=1' }), { status: 201 }));
    await mountImage();
    fireEvent.click(screen.getByLabelText('Replace image'));
    fireEvent.change(screen.getByLabelText('Replacement image URL'), { target: { value: 'https://example.com/b.png' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Replace image from URL')); });

    expect(JSON.parse(String(posts(fetchSpy)[0]![1].body))).toEqual({ imageUrl: 'https://example.com/b.png' });
    await waitFor(() => expect(lastSource()).toBe(replaced('New222')));
    const update = posted.filter((m) => m.type === 'mx:document' && m.refData).at(-1);
    expect(update?.refData).toEqual({ New222: { kind: 'image', url: '/a/New222/raw?v=1' } });

    await act(async () => { fireEvent.click(screen.getByLabelText('Undo')); });
    await waitFor(() => expect(lastSource()).toBe(IMG_SOURCE));
  });

  it('Replace ▸ Upload file sends the file through the upload door and replaces', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'New333' }), { status: 201 }));
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    await mountImage();
    fireEvent.click(screen.getByLabelText('Replace image'));
    fireEvent.click(screen.getByLabelText('Replace image from file'));
    const input = screen.getByLabelText('Replacement image file') as HTMLInputElement;
    expect(pick.mock.contexts.at(-1)).toBe(input);
    const file = new File(['x'], 'b.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });

    await waitFor(() => expect(lastSource()).toBe(replaced('New333')));
    expect(posts(fetchSpy)[0]![1]).toMatchObject({ body: file, headers: { 'Content-Type': 'image/png' } });
  });

  it('a double-click in the document opens the replace picker for that image', async () => {
    stubFetch(new Response(JSON.stringify({ id: 'New444' }), { status: 201 }));
    const pick = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    render(
      <InPlaceEditor
        art={imgArt as React.ComponentProps<typeof InPlaceEditor>['art']}
        frameRef={{ current: frameEl }}
        sessionNonce={NONCE}
      />,
    );
    await fromFrame({ type: 'mx:image-replace', path: '0.1' });
    const input = screen.getByLabelText('Replacement image file') as HTMLInputElement;
    expect(pick.mock.contexts.at(-1)).toBe(input);
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['x'], 'c.png', { type: 'image/png' })] } });
    });
    await waitFor(() => expect(lastSource()).toBe(replaced('New444')));
  });

  it('a file dropped ONTO the image replaces it; one dropped elsewhere still inserts', async () => {
    stubFetch(new Response(JSON.stringify({ id: 'New555' }), { status: 201 }));
    await mountImage();
    await fromFrame({ type: 'mx:image-drop', file: new File(['x'], 'd.png', { type: 'image/png' }), target: '0.1' });
    await waitFor(() => expect(lastSource()).toBe(replaced('New555')));

    stubFetch(new Response(JSON.stringify({ id: 'New666' }), { status: 201 }));
    await fromFrame({ type: 'mx:image-drop', file: new File(['x'], 'e.png', { type: 'image/png' }) });
    await waitFor(() => expect(lastSource()).toContain('ref:New666'));
    expect(lastSource()).toContain('ref:New555');
    expect(lastSource().match(/<img/g)).toHaveLength(2);
  });

  it('refuses to replace a target that is not an image — nothing is uploaded', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'New777' }), { status: 201 }));
    await mountImage();
    await fromFrame({ type: 'mx:image-drop', file: new File(['x'], 'f.png', { type: 'image/png' }), target: '0.0' });
    await new Promise((r) => setTimeout(r, 20));
    expect(posts(fetchSpy)).toHaveLength(0);
    expect(queue).not.toHaveBeenCalled();
  });

  /*
   * The document never renders its <Helmet>, so BODY paths (what the frame
   * reports) are offset from SOURCE paths. Replace and alt must translate.
   */
  it('replaces and describes the right image in a document with a <Helmet>', async () => {
    const HELMET = `<Helmet><title>t</title></Helmet>${IMG_SOURCE}`;
    stubFetch(new Response(JSON.stringify({ id: 'New888' }), { status: 201 }));
    render(
      <InPlaceEditor
        art={{ ...imgArt, markup: HELMET } as React.ComponentProps<typeof InPlaceEditor>['art']}
        frameRef={{ current: frameEl }}
        sessionNonce={NONCE}
      />,
    );
    await fromFrame({ type: 'mx:selection', selection: IMG_SELECTION }); // body path 0.1
    await fromFrame({ type: 'mx:image-drop', file: new File(['x'], 'h.png', { type: 'image/png' }), target: '0.1' });
    await waitFor(() => expect(lastSource()).toBe(HELMET.replace('ref:Old111', 'ref:New888')));
    fireEvent.click(screen.getByLabelText('Alt text'));
    expect((screen.getByLabelText('Image alt text') as HTMLInputElement).value).toBe('A chart');
    fireEvent.change(screen.getByLabelText('Image alt text'), { target: { value: 'Revenue' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Save alt text')); });
    expect(lastSource()).toBe(HELMET.replace('ref:Old111', 'ref:New888').replace('alt="A chart"', 'alt="Revenue"'));
  });

  it('alt text: add, edit and remove, each one undoable step', async () => {
    await mountImage();
    fireEvent.click(screen.getByLabelText('Alt text'));
    const field = screen.getByLabelText('Image alt text') as HTMLInputElement;
    expect(field.value).toBe('A chart');
    fireEvent.change(field, { target: { value: 'Revenue by month' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Save alt text')); });
    expect(lastSource()).toBe(IMG_SOURCE.replace('alt="A chart"', 'alt="Revenue by month"'));

    fireEvent.click(screen.getByLabelText('Alt text'));
    fireEvent.change(screen.getByLabelText('Image alt text'), { target: { value: '' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Save alt text')); });
    expect(lastSource()).toBe(IMG_SOURCE.replace(' alt="A chart"', ''));
    // With no alt, the control hints.
    expect(screen.getByLabelText('Add alt text')).toBeTruthy();

    await act(async () => { fireEvent.click(screen.getByLabelText('Undo')); });
    await waitFor(() => expect(lastSource()).toBe(IMG_SOURCE.replace('alt="A chart"', 'alt="Revenue by month"')));
  });
});
