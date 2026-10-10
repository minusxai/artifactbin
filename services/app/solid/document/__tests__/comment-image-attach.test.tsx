/* @jsxImportSource solid-js */
/**
 * A SCREENSHOT INTO A COMMENT — pasted from the clipboard, dropped onto the composer, or picked with
 * "Attach image". Each becomes the comment's one image through the existing upload path (`method:
 * 'upload'`), opens in the brush editor and replaces whatever image the draft had. Text paste is
 * untouched; a wrong type or an oversize file says so inline; a backend without comment images
 * attaches nothing; a file dropped beside the composer neither navigates nor closes it.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/dom';
import { STORY_ANNOTATION_LAYOUT_MESSAGE, type StoryEditSelection } from '@/lib/story-runtime/contract';
import type { ArtifactBackend } from '@/lib/artifact-backend/types';
import { COMMENT_IMAGE_LIMITS } from '../../../../contracts/src/comment-image';
import { fireEvent } from '../../__tests__/helpers';
import { preloadCommentField } from '../LazyCommentField';
import { ANN, fetchCalls, flush, httpBackend, installAnnotationFetch, knobs, layer } from './annotation-rig';
import { replaceComment } from './comment-input';

const TEXT: StoryEditSelection = { kind: 'text', path: '1', tag: 'p', rect: { x: 5, y: 6, width: 200, height: 40 }, className: '', style: '', ancestors: [] } as StoryEditSelection;
const png = (name = 'shot.png', type = 'image/png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type });
const clipboard = (files: File[], text = '') => ({ files, types: [...(files.length ? ['Files'] : []), ...(text ? ['text/plain'] : [])], getData: (type: string) => (type === 'text/plain' ? text : '') });
const transfer = (files: File[]) => ({ files, types: ['Files'], dropEffect: 'none', effectAllowed: 'all' });

const creates = () => fetchCalls.filter((call) => call.url.endsWith('/api/my/artifacts/doc1/annotations') && call.init?.method === 'POST');
const stages = () => fetchCalls.filter((call) => call.url.endsWith('/api/my/artifacts/doc1/comment-images') && call.init?.method === 'POST');
const composer = () => screen.getByRole('dialog', { name: 'Annotation composer' });
const field = () => screen.getByLabelText('Annotation comment');
const editorCanvas = () => screen.getByLabelText('Screenshot drawing canvas') as HTMLCanvasElement;

let bitmaps: Array<{ width: number; height: number }> = [];
const decode = vi.fn(async () => { const next = bitmaps.shift() ?? { width: 300, height: 200 }; return { ...next, close: vi.fn() }; });

beforeEach(() => {
  installAnnotationFetch();
  bitmaps = [];
  decode.mockClear();
  vi.stubGlobal('createImageBitmap', decode);
  // The brush editor loads its image through an <img>; this one loads as soon as it has a source.
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const context = { clearRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(new Blob(['png'], { type: 'image/png' })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('attaching an image to a new comment', () => {
  beforeAll(() => preloadCommentField());
  const open = (over: Parameters<typeof layer>[0] = {}) => layer({ initialSelection: TEXT, editId: 'edit-current', ...over });

  it('pastes a clipboard screenshot as the comment image and saves it with the comment', async () => {
    open(); await flush();
    replaceComment(field(), 'look at this');
    fireEvent.paste(field(), { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(screen.getByLabelText('Screenshot editor')).toBeTruthy());
    expect(field()).toHaveTextContent('look at this');
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByLabelText('Save annotation')).toBeEnabled();
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush(); await flush();
    expect(stages()).toHaveLength(1);
    const form = stages()[0]!.init!.body as FormData;
    expect(JSON.parse(String(form.get('metadata')))).toMatchObject({ method: 'upload', capturedEditId: 'edit-current', width: 300, height: 200 });
    const body = JSON.parse(String(creates()[0]!.init!.body));
    expect(body).toMatchObject({ node_id: 'node-1', body: 'look at this', edit_id: 'edit-current' });
    expect(body.attachment_id).toEqual(expect.any(String));
  });

  it('keeps an ordinary text paste as text', async () => {
    open(); await flush();
    replaceComment(field(), 'just words');
    expect(field()).toHaveTextContent('just words');
    expect(decode).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Screenshot editor')).toBeNull();
  });

  it('pastes a copied image file whose clipboard text is only its name', async () => {
    open(); await flush();
    fireEvent.paste(field(), { clipboardData: clipboard([png('diagram.png')], 'diagram.png') });
    await waitFor(() => expect(screen.getByLabelText('Screenshot editor')).toBeTruthy());
    expect(field()).not.toHaveTextContent('diagram.png');
  });

  it('shows a drop target while a file is dragged over the composer and attaches the dropped image', async () => {
    open(); await flush();
    const target = composer();
    const over = fireEvent.dragEnter(target, { dataTransfer: transfer([]) });
    fireEvent.dragOver(target, { dataTransfer: transfer([]) });
    expect(over).toBe(false);
    expect(screen.getByText('Drop image to attach')).toBeVisible();
    const dropped = fireEvent.drop(field(), { dataTransfer: transfer([png('dropped.webp', 'image/webp')]) });
    expect(dropped).toBe(false);
    expect(screen.queryByText('Drop image to attach')).toBeNull();
    await waitFor(() => expect(screen.getByLabelText('Screenshot editor')).toBeTruthy());
  });

  it('offers Attach image at all times and replaces the draft image with the newest one, within the pixel limit', async () => {
    bitmaps = [{ width: 300, height: 200 }, { width: 4096, height: 3000 }];
    open(); await flush();
    const input = screen.getByLabelText('Attach image') as HTMLInputElement;
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp');
    fireEvent.change(input, { target: { files: [png()] } });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('width', '300'));
    fireEvent.paste(field(), { clipboardData: clipboard([png('big.png')]) });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('width', String(COMMENT_IMAGE_LIMITS.edge)));
    expect(screen.getAllByLabelText('Screenshot editor')).toHaveLength(1);
    const canvas = editorCanvas();
    expect(Number(canvas.getAttribute('width')) * Number(canvas.getAttribute('height'))).toBeLessThanOrEqual(COMMENT_IMAGE_LIMITS.pixels);
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.queryByLabelText('Screenshot editor')).toBeNull();
  });

  it('refuses a type the server will not store, inline', async () => {
    open(); await flush();
    fireEvent.paste(field(), { clipboardData: clipboard([png('anim.gif', 'image/gif')]) });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Attach a PNG, JPEG or WebP image.'));
    expect(decode).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Screenshot editor')).toBeNull();
  });

  it('refuses a file over the comment image size limit, inline', async () => {
    open(); await flush();
    const big = png('huge.png');
    Object.defineProperty(big, 'size', { value: COMMENT_IMAGE_LIMITS.bytes + 1 });
    fireEvent.drop(composer(), { dataTransfer: transfer([big]) });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('This image is larger than 50 MB.'));
    expect(decode).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Screenshot editor')).toBeNull();
  });

  it('attaches nothing where the backend cannot store comment images', async () => {
    const gated: ArtifactBackend = { ...httpBackend('doc1'), unavailable: (feature) => (feature === 'commentImages' ? 'Screenshots need a connection.' : null) };
    open({ backend: gated }); await flush();
    expect(screen.getByLabelText('Attach image')).toBeDisabled();
    fireEvent.dragEnter(composer(), { dataTransfer: transfer([]) });
    expect(screen.queryByText('Drop image to attach')).toBeNull();
    fireEvent.drop(composer(), { dataTransfer: transfer([png()]) });
    fireEvent.paste(field(), { clipboardData: clipboard([png()]) });
    await flush();
    expect(decode).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Screenshot editor')).toBeNull();
    expect(stages()).toHaveLength(0);
  });

  it('a file dropped beside the composer neither navigates nor closes it', async () => {
    open(); await flush();
    replaceComment(field(), 'still here');
    expect(fireEvent.dragOver(document.body, { dataTransfer: transfer([]) })).toBe(false);
    expect(fireEvent.drop(document.body, { dataTransfer: transfer([png()]) })).toBe(false);
    await flush();
    expect(composer()).toBeTruthy();
    expect(field()).toHaveTextContent('still here');
    expect(decode).not.toHaveBeenCalled();
  });
});

describe('attaching an image to a reply', () => {
  beforeAll(() => preloadCommentField());
  const replies = () => fetchCalls.filter((call) => call.url.endsWith(`/api/my/artifacts/doc1/annotations/${ANN.id}`) && call.init?.method === 'POST');
  const openThread = async (over: Parameters<typeof layer>[0] = {}) => {
    layer({ railOpen: true, pickOnOpen: false, editId: 'edit-current', ...over }); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Open annotation thread' })); await flush();
    return screen.getByLabelText('Reply to annotation');
  };

  it('pastes an image into the reply box and sends it with the reply', async () => {
    const reply = await openThread();
    replaceComment(reply, 'here is the broken state');
    fireEvent.paste(reply, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('aria-busy', 'false'));
    expect(reply).toHaveTextContent('here is the broken state');
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' })); await flush(); await flush();
    expect(stages()).toHaveLength(1);
    expect(JSON.parse(String((stages()[0]!.init!.body as FormData).get('metadata')))).toMatchObject({ method: 'upload', capturedEditId: 'edit-current' });
    const body = JSON.parse(String(replies()[0]!.init!.body));
    expect(body).toMatchObject({ reply: 'here is the broken state', edit_id: 'edit-current' });
    expect(body.attachment_id).toEqual(expect.any(String));
    await waitFor(() => expect(screen.queryByLabelText('Screenshot editor')).toBeNull());
  });

  it('drops an image onto the reply box and picks one with Attach image', async () => {
    const reply = await openThread();
    fireEvent.dragEnter(reply, { dataTransfer: transfer([]) });
    expect(screen.getByText('Drop image to attach')).toBeVisible();
    fireEvent.drop(reply, { dataTransfer: transfer([png()]) });
    await waitFor(() => expect(screen.getByLabelText('Screenshot editor')).toBeTruthy());
    bitmaps = [{ width: 640, height: 480 }];
    fireEvent.change(screen.getByLabelText('Attach image'), { target: { files: [png('second.png')] } });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('width', '640'));
  });

  it('sends a reply without an image exactly as before', async () => {
    const reply = await openThread();
    replaceComment(reply, 'words only');
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' })); await flush();
    expect(JSON.parse(String(replies()[0]!.init!.body))).toEqual({ reply: 'words only' });
    expect(stages()).toHaveLength(0);
  });

  it('offers no attachment where the backend cannot store comment images', async () => {
    const gated: ArtifactBackend = { ...httpBackend('doc1'), unavailable: (feature) => (feature === 'commentImages' ? 'Screenshots need a connection.' : null) };
    const reply = await openThread({ backend: gated });
    expect(screen.getByLabelText('Attach image')).toBeDisabled();
    fireEvent.paste(reply, { clipboardData: clipboard([png()]) });
    await flush();
    expect(decode).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Screenshots need a connection.');
  });

  it("draws each reply's own image under that reply", async () => {
    const image = (id: string) => ({ id, width: 100, height: 50, capturedEditId: 'edit-current', capturedAt: '2026-10-10T00:00:00.000Z', originalUrl: `/i/${id}?variant=original`, previewUrl: `/i/${id}?variant=preview`, thumbnailUrl: `/i/${id}?variant=thumbnail` });
    knobs.open = [{ ...ANN, thread: [{ ...ANN.thread[0]!, image: { ...image('cim_root'), method: 'region' as const } }, { ...ANN.thread[1]!, image: { ...image('cim_reply'), method: 'upload' as const } }] }];
    await openThread();
    const items = within(screen.getByLabelText('Annotation thread')).getAllByRole('listitem');
    // A captured shot is a Screenshot; an attached picture is an Image — in the preview, its button and its reader.
    expect(within(items[0]!).getByRole('img', { name: 'Screenshot attached to comment' })).toHaveAttribute('src', '/i/cim_root?variant=thumbnail');
    expect(within(items[0]!).getByRole('button', { name: 'Open comment screenshot' })).toHaveTextContent('Screenshot');
    expect(within(items[1]!).queryByRole('img', { name: 'Screenshot attached to comment' })).toBeNull();
    expect(within(items[1]!).getByRole('img', { name: 'Image attached to comment' })).toHaveAttribute('src', '/i/cim_reply?variant=thumbnail');
    const open = within(items[1]!).getByRole('button', { name: 'Open comment image' });
    expect(open).toHaveTextContent('Image');
    expect(open).not.toHaveTextContent('Screenshot');
    expect(items[1]!.querySelector('dialog')).toHaveAttribute('aria-label', 'Comment image');
    expect(items[1]!.querySelector('dialog a')).toHaveAttribute('aria-label', 'Open image at full size');
  });

  it.each([
    ['invalid_attachment', 400, 'The image could not be attached; try again.'],
    ['stale', 409, 'The document changed while you were replying; send again to attach the image.'],
  ])('shows a refused reply image (%s) as such, keeps the draft and uploads afresh on the next send', async (code, status, message) => {
    const reply = await openThread();
    const real = globalThis.fetch;
    let refuse = true;
    vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
      if (refuse && init?.method === 'POST' && String(url).endsWith(`/annotations/${ANN.id}`)) {
        refuse = false;
        fetchCalls.push({ url: String(url), init });
        return new Response(JSON.stringify({ error: code, message }), { status });
      }
      return real(url, init);
    }) as unknown as typeof fetch);
    replaceComment(reply, 'with a picture');
    fireEvent.paste(reply, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' })); await flush(); await flush();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(screen.getByLabelText('Reply to annotation')).toHaveTextContent('with a picture');
    expect(screen.getByLabelText('Screenshot editor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' })); await flush(); await flush();
    expect(stages()).toHaveLength(2);
    expect(replies()).toHaveLength(2);
    await waitFor(() => expect(screen.queryByLabelText('Screenshot editor')).toBeNull());
  });
});

describe('attaching an image to a reply from the hover card', () => {
  beforeAll(() => preloadCommentField());
  const replies = () => fetchCalls.filter((call) => call.url.endsWith(`/api/my/artifacts/doc1/annotations/${ANN.id}`) && call.init?.method === 'POST');
  const hoverCard = async () => {
    const view = layer({ showViewComments: true, editId: 'edit-current' });
    await flush(); await flush();
    view.runtime.emit({ type: STORY_ANNOTATION_LAYOUT_MESSAGE, positions: [{ id: ANN.id, rect: { x: 10, y: 120, width: 300, height: 40 } }] });
    const card = view.container.querySelector<HTMLElement>(`[data-annotation-id="${ANN.id}"]`)!;
    fireEvent.mouseEnter(card);
    fireEvent.click(within(card).getByRole('button', { name: 'Expand replies' }));
    return { card, field: await screen.findByRole('textbox', { name: 'Reply to annotation' }) };
  };

  it('the hover card reply box is the same box: paste an image and send it with the reply', async () => {
    const { card, field } = await hoverCard();
    expect(within(card).getByLabelText('Attach image')).toBeEnabled();
    replaceComment(field, 'from the card');
    fireEvent.paste(field, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(within(card).getByLabelText('Screenshot drawing canvas')).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(within(card).getByRole('button', { name: 'Send reply' })); await flush(); await flush();
    expect(stages()).toHaveLength(1);
    const body = JSON.parse(String(replies()[0]!.init!.body));
    expect(body).toMatchObject({ reply: 'from the card', edit_id: 'edit-current' });
    expect(body.attachment_id).toEqual(expect.any(String));
    await waitFor(() => expect(within(card).queryByLabelText('Screenshot editor')).toBeNull());
  });

  it("shows a reply's image in the hover card's replies", async () => {
    const image = { id: 'cim_card', method: 'upload' as const, width: 100, height: 50, capturedEditId: 'edit-current', capturedAt: '2026-10-10T00:00:00.000Z', originalUrl: '/i/cim_card?variant=original', previewUrl: '/i/cim_card?variant=preview', thumbnailUrl: '/i/cim_card?variant=thumbnail' };
    knobs.open = [{ ...ANN, thread: [ANN.thread[0]!, { ...ANN.thread[1]!, image }] }];
    const { card } = await hoverCard();
    const list = within(card).getByRole('list', { name: 'Thread replies' });
    expect(within(list).getByRole('img', { name: 'Image attached to comment' })).toHaveAttribute('src', '/i/cim_card?variant=thumbnail');
  });
});

/**
 * AFTER A LIVE VERSION (production regression): the page's revision may be older than the head by the time an
 * image is attached. An attached image is of no version: it is staged against the head the server names and the
 * write goes through, once, automatically — and it never says "retake the screenshot", which only a captured one can.
 */
describe('an attached image when the document moved', () => {
  beforeAll(() => preloadCommentField());
  const replies = () => fetchCalls.filter((call) => call.url.endsWith(`/api/my/artifacts/doc1/annotations/${ANN.id}`) && call.init?.method === 'POST');
  const staged = (index: number) => JSON.parse(String((stages()[index]!.init!.body as FormData).get('metadata')));
  /** Answer the first `times` matching POSTs with a refusal, then let the rig answer. */
  const refuse = (matches: (url: string) => boolean, times: number, status: number, body: unknown) => {
    const real = globalThis.fetch;
    let left = times;
    vi.stubGlobal('fetch', (async (url: string, init?: RequestInit) => {
      if (left > 0 && init?.method === 'POST' && matches(String(url))) {
        left -= 1;
        fetchCalls.push({ url: String(url), init });
        return new Response(JSON.stringify(body), { status });
      }
      return real(url, init);
    }) as unknown as typeof fetch);
  };

  it('restages a dropped image against the head the stage refusal names, and saves', async () => {
    layer({ initialSelection: TEXT, editId: 'edit-loaded' }); await flush();
    refuse((url) => url.endsWith('/comment-images'), 1, 409, { error: 'stale', edit_id: 'edit-live' });
    replaceComment(field(), 'after a live version');
    fireEvent.drop(composer(), { dataTransfer: transfer([png()]) });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush(); await flush(); await flush();
    expect(stages().map((_, index) => staged(index).capturedEditId)).toEqual(['edit-loaded', 'edit-live']);
    expect(JSON.parse(String(creates()[0]!.init!.body))).toMatchObject({ body: 'after a live version', edit_id: 'edit-live', attachment_id: expect.any(String) });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull());
  });

  it('restages once when the comment write itself says the head moved, and saves', async () => {
    layer({ initialSelection: TEXT, editId: 'edit-loaded' }); await flush();
    refuse((url) => url.endsWith('/api/my/artifacts/doc1/annotations'), 1, 409, { error: 'stale', edit_id: 'edit-newer', version: 3 });
    replaceComment(field(), 'moved while saving');
    fireEvent.paste(field(), { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush(); await flush(); await flush();
    expect(stages().map((_, index) => staged(index).capturedEditId)).toEqual(['edit-loaded', 'edit-newer']);
    expect(creates().map((call) => JSON.parse(String(call.init!.body)).edit_id)).toEqual(['edit-loaded', 'edit-newer']);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Annotation composer' })).toBeNull());
  });

  it('a reply with a pasted image follows a moved head without asking', async () => {
    layer({ railOpen: true, pickOnOpen: false, editId: 'edit-loaded' }); await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Open annotation thread' })); await flush();
    const reply = screen.getByLabelText('Reply to annotation');
    refuse((url) => url.endsWith(`/annotations/${ANN.id}`), 1, 409, { error: 'stale', edit_id: 'edit-live', message: 'The document changed while you were replying; send again to attach the image.' });
    replaceComment(reply, 'on the new version');
    fireEvent.paste(reply, { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' })); await flush(); await flush(); await flush();
    expect(replies().map((call) => JSON.parse(String(call.init!.body)).edit_id)).toEqual(['edit-loaded', 'edit-live']);
    expect(staged(1).capturedEditId).toBe('edit-live');
    await waitFor(() => expect(screen.queryByLabelText('Screenshot editor')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an attached image that still cannot follow the head says so without "retake the screenshot"', async () => {
    layer({ initialSelection: TEXT, editId: 'edit-loaded' }); await flush();
    refuse((url) => url.endsWith('/comment-images'), 5, 409, { error: 'stale', edit_id: 'edit-moving' });
    replaceComment(field(), 'keeps moving');
    fireEvent.paste(field(), { clipboardData: clipboard([png()]) });
    await waitFor(() => expect(editorCanvas()).toHaveAttribute('aria-busy', 'false'));
    fireEvent.click(screen.getByLabelText('Save annotation')); await flush(); await flush(); await flush();
    expect(stages()).toHaveLength(2);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The document changed while you were commenting. Your draft is preserved; send it again.');
    expect(alert).not.toHaveTextContent(/retake/i);
    expect(field()).toHaveTextContent('keeps moving');
    expect(screen.getByLabelText('Screenshot editor')).toBeTruthy();
  });
});

