/**
 * Insert image FROM A URL — the human half of web importing. The button opens
 * a small popover with both ways in; pasting a URL posts `imageUrl` to the
 * browser's own create door (the same
 * ingest-and-own path the agent door runs) and inserts `ref:<id>` into the
 * source. A refusal SHOWS — the door's whole point is naming what failed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';

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
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
const lastSource = () => (queue.mock.calls.at(-1)?.[0] as { source?: string } | undefined)?.source ?? '';
const posts = (spy: ReturnType<typeof stubFetch>) =>
  spy.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'POST') as Array<[string, RequestInit]>;
const selectionOf = (path: string, tag: string, kind = 'element') => ({
  kind, path, tag, rect: { x: 0, y: 0, width: 10, height: 10 }, className: '', style: '', ancestors: [],
});

/**
 * INSERTING AN IMAGE: Insert ▸ Image… opens one dialog (Upload / From URL,
 * preview, then Insert), and the image goes AT THE NODE the person is on —
 * below a text block, inside a container, at the end only when nothing is
 * selected — then is selected and scrolled to. One undo takes it out.
 */
describe('inserting an image', () => {
  const DOC = '<div data-design="tw" className="p-4"><h1 id="h">Title</h1><p id="p1">one</p><p id="p2">two</p>'
    + '<Card id="c"><CardContent id="cc"><p id="p3">in card</p></CardContent></Card></div>';
  const IMG = (id: string) => `<img src="ref:${id}" alt="" className="my-6 block w-full rounded-md" />`;
  /** The inserted image carries a freshly minted node id; compare without it. */
  const inserted = () => lastSource().replace(/(<img src="ref:New\d+"[^>]*?) id="[A-Za-z][A-Za-z0-9]{3}"/g, '$1');
  const mountDoc = () => render(
    <InPlaceEditor
      art={{ ...art, markup: DOC } as React.ComponentProps<typeof InPlaceEditor>['art']}
      frameRef={{ current: frameEl }}
      sessionNonce={NONCE}
    />,
  );
  const openDialog = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Image…' }));
    return screen.getByRole('dialog', { name: 'Insert image' });
  };
  const importUrl = async (url = 'https://example.com/b.png') => {
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: url } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });
  };
  const confirm = async () => {
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Insert' })).not.toBeDisabled());
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Insert' })); });
  };

  it('Insert is a plain menu: Image… and Paste Markdown', () => {
    mountDoc();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    const menu = screen.getByLabelText('Insert options');
    expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['Image…', 'Paste Markdown']);
    fireEvent.click(screen.getByRole('button', { name: 'Image…' }));
    expect(screen.getByRole('dialog', { name: 'Insert image' })).toBeTruthy();
  });

  it('with a caret in a paragraph: imports, inserts directly below it, selects and reveals it; one undo removes it', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'New222', rawUrl: '/a/New222/raw?v=1' }), { status: 201 }));
    mountDoc();
    await fromFrame({ type: 'mx:selection', selection: selectionOf('0.1', 'p', 'text') });
    openDialog();
    // Focus moving into the dialog can clear the document's selection; the target was captured on open.
    await fromFrame({ type: 'mx:selection', selection: null });
    await importUrl();
    expect(JSON.parse(String(posts(fetchSpy)[0]![1].body))).toEqual({ imageUrl: 'https://example.com/b.png' });
    expect(queue).not.toHaveBeenCalled(); // nothing changes before Insert
    await confirm();
    await waitFor(() => expect(inserted()).toBe(DOC.replace('<p id="p1">one</p>', `<p id="p1">one</p>${IMG('New222')}`)));
    expect(lastSource()).toMatch(/<img src="ref:New222"[^>]* id="[A-Za-z][A-Za-z0-9]{3}" \/>/);
    expect(screen.queryByRole('dialog')).toBeNull();
    const update = posted.filter((m) => m.type === 'mx:document' && m.refData).at(-1);
    expect(update?.refData).toEqual({ New222: { kind: 'image', url: '/a/New222/raw?v=1' } });
    expect(posted.filter((m) => m.type === 'mx:select').at(-1)).toMatchObject({ path: '0.2', reveal: true });

    await act(async () => { fireEvent.click(screen.getByLabelText('Undo')); });
    await waitFor(() => expect(inserted()).toBe(DOC));
  });

  it('with a card selected: inside the card, at the end of its contents', async () => {
    stubFetch(new Response(JSON.stringify({ id: 'New333' }), { status: 201 }));
    mountDoc();
    await fromFrame({ type: 'mx:selection', selection: selectionOf('0.3.0', 'CardContent', 'embed') });
    openDialog();
    await importUrl();
    await confirm();
    await waitFor(() => expect(inserted()).toContain(`<p id="p3">in card</p>${IMG('New333')}</CardContent>`));
  });

  it('with nothing selected: at the end of the document', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'New444' }), { status: 201 }));
    mountDoc();
    openDialog();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } }); });
    expect(posts(fetchSpy)[0]![1]).toMatchObject({ body: file, headers: { 'Content-Type': 'image/png' } });
    await confirm();
    await waitFor(() => expect(inserted()).toBe(DOC.replace('</Card></div>', `</Card>${IMG('New444')}</div>`)));
  });

  it('shows the door\'s refusal in the dialog — a dead URL is a sentence, not silence', async () => {
    stubFetch(new Response(
      JSON.stringify({ error: 'image_fetch_failed', details: ['https://example.com/gone.png: answered 404'] }),
      { status: 400 },
    ));
    mountDoc();
    const dialog = openDialog();
    await importUrl('https://example.com/gone.png');
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('404'));
    expect(within(dialog).getByRole('button', { name: 'Insert' })).toBeDisabled();
    expect(queue).not.toHaveBeenCalled();
  });

  it('a pasted image lands below the block with the caret; a dropped one in the gap it was dropped in', async () => {
    stubFetch(new Response(JSON.stringify({ id: 'New555' }), { status: 201 }));
    mountDoc();
    await fromFrame({ type: 'mx:selection', selection: selectionOf('0.2', 'p', 'text') });
    await fromFrame({ type: 'mx:image-drop', file: new File(['x'], 'p.png', { type: 'image/png' }) });
    await waitFor(() => expect(inserted()).toContain(`<p id="p2">two</p>${IMG('New555')}`));
    expect(posted.filter((m) => m.type === 'mx:select').at(-1)).toMatchObject({ path: '0.3', reveal: true });

    stubFetch(new Response(JSON.stringify({ id: 'New666' }), { status: 201 }));
    await fromFrame({ type: 'mx:image-drop', file: new File(['x'], 'd.png', { type: 'image/png' }), at: { path: '0.1', side: 'before' } });
    await waitFor(() => expect(inserted()).toContain(`<h1 id="h">Title</h1>${IMG('New666')}<p id="p1">`));
  });
});

describe('replacing an image', () => {
  const IMG_SOURCE = '<div data-design="tw" className="p-4"><h1 id="h">Title</h1>'
    + '<img id="im" src="ref:Old111" alt="A chart" className="my-6 w-1/2 rounded-xl" /></div>';
  const imgArt = { ...art, markup: IMG_SOURCE };
  const IMG_SELECTION = {
    kind: 'element', path: '0.1', tag: 'img', rect: { x: 0, y: 0, width: 10, height: 10 },
    className: 'my-6 w-1/2 rounded-xl', style: '', ancestors: [],
  };

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
  const replaced = (id: string) => IMG_SOURCE.replace('ref:Old111', `ref:${id}`);
  const replaceIn = async () => {
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Replace image' })).getByRole('button', { name: 'Replace' })).not.toBeDisabled());
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Replace' })); });
  };

  it('Replace ▸ From URL (the dialog) swaps only the src, pushes the new ref, and one undo restores the old picture', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'New222', rawUrl: '/a/New222/raw?v=1' }), { status: 201 }));
    await mountImage();
    fireEvent.click(screen.getByLabelText('Replace image'));
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/b.png' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });
    await replaceIn();

    expect(JSON.parse(String(posts(fetchSpy)[0]![1].body))).toEqual({ imageUrl: 'https://example.com/b.png' });
    await waitFor(() => expect(lastSource()).toBe(replaced('New222')));
    const update = posted.filter((m) => m.type === 'mx:document' && m.refData).at(-1);
    expect(update?.refData).toEqual({ New222: { kind: 'image', url: '/a/New222/raw?v=1' } });

    await act(async () => { fireEvent.click(screen.getByLabelText('Undo')); });
    await waitFor(() => expect(lastSource()).toBe(IMG_SOURCE));
  });

  it('Replace ▸ Upload in the dialog sends the file through the upload door and replaces', async () => {
    const fetchSpy = stubFetch(new Response(JSON.stringify({ id: 'New333' }), { status: 201 }));
    await mountImage();
    fireEvent.click(screen.getByLabelText('Replace image'));
    const file = new File(['x'], 'b.png', { type: 'image/png' });
    await act(async () => { fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } }); });
    await replaceIn();
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
