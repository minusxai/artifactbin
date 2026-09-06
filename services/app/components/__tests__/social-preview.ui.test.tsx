import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SocialPreviewDialog from '../SocialPreviewDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const loadOverview = () => {
  const image = screen.getByAltText('Artifact preview') as HTMLImageElement;
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 400 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 420 });
  fireEvent.load(image);
};

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('social preview dialog', () => {
  it('loads the versioned, editor-only overview and resets by removing the directive', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, { edit_id: 'e2' }));
    vi.stubGlobal('fetch', fetchMock);
    const close = vi.fn();
    render(
      <SocialPreviewDialog
        id="story1"
        source={'<Helmet><meta name="artifactbin:og-crop" content="x=300;y=900;width=800" /></Helmet><p>x</p>'}
        editId="e1"
        version={4}
        onClose={close}
      />,
    );
    expect(screen.getByAltText('Artifact preview')).toHaveAttribute(
      'src', '/a/story1/export?mode=preview&format=jpg&v=4&pv=2',
    );
    expect(screen.getByRole('status')).toHaveTextContent('rendering full-page overview');
    loadOverview();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Social preview canvas')).toBeInTheDocument();
    expect(document.querySelector('img[aria-hidden="true"]')).toHaveAttribute(
      'src', '/a/story1/export?mode=preview&format=png&v=4&pv=2&focus=1&crop=x%3D300%3By%3D900%3Bwidth%3D800',
    );
    fireEvent.click(screen.getByLabelText('Reset social preview'));
    fireEvent.click(screen.getByText('save preview'));
    await waitFor(() => expect(close).toHaveBeenCalled());
    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(sent.edit_id).toBe('e1');
    expect(sent.source).toBe('<Helmet></Helmet><p>x</p>');
  });

  it('moves and resizes with the keyboard while preserving the locked-ratio model', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, { edit_id: 'e2' }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SocialPreviewDialog id="story1" source="<p>x</p>" editId="e1" version={1} onClose={() => {}} />);
    loadOverview();
    const frame = screen.getByLabelText('Move social preview crop');
    fireEvent.keyDown(frame, { key: 'ArrowDown' });
    const resize = screen.getByLabelText('Resize social preview crop');
    fireEvent.keyDown(resize, { key: 'ArrowLeft' });
    expect(frame).toHaveAttribute('aria-valuetext', 'x 0, y 10, width 1580');
    fireEvent.click(screen.getByText('save preview'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(sent.source).toContain('content="x=0;y=10;width=1580"');
  });

  it('keeps an inward resize stable, then focuses and sharpens it on release', () => {
    render(
      <SocialPreviewDialog
        id="story1"
        source={'<Helmet><meta name="artifactbin:og-crop" content="x=300;y=900;width=800" /></Helmet><p>x</p>'}
        editId="e1"
        version={4}
        onClose={() => {}}
      />,
    );
    loadOverview();
    const canvas = screen.getByLabelText('Social preview canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ width: 800 } as DOMRect);
    const overview = screen.getByAltText('Artifact preview');
    const frame = screen.getByLabelText('Move social preview crop');
    const resize = screen.getByLabelText('Resize social preview crop');
    resize.setPointerCapture = vi.fn();
    const before = overview.style.width;

    fireEvent.pointerDown(resize, { pointerId: 1, clientX: 700, clientY: 400 });
    fireEvent.pointerMove(resize, { pointerId: 1, clientX: 600, clientY: 350 });
    expect(overview.style.width).toBe(before);
    expect(frame).not.toHaveAttribute('aria-valuetext', 'x 300, y 900, width 800');

    fireEvent.pointerUp(resize, { pointerId: 1 });
    expect(overview.style.width).not.toBe(before);
    expect(document.querySelector('img[src*="focus=1"]')).toHaveAttribute('src', expect.stringContaining('width%3D693'));

    fireEvent.pointerDown(resize, { pointerId: 2, clientX: 600, clientY: 350 });
    fireEvent.pointerMove(resize, { pointerId: 2, clientX: 640, clientY: 350 });
    expect(Number(frame.getAttribute('aria-valuetext')?.match(/width (\d+)/)?.[1])).toBeGreaterThanOrEqual(780);
    fireEvent.pointerUp(resize, { pointerId: 2 });
  });

  it('keeps the draft framing when a concurrent edit moves the document head', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(409, {
      error: 'doc_changed', edit_id: 'e2', source: '<Helmet><title>new</title></Helmet><p>x</p>',
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(<SocialPreviewDialog id="story1" source="<p>x</p>" editId="e1" version={1} onClose={() => {}} />);
    loadOverview();
    fireEvent.keyDown(screen.getByLabelText('Resize social preview crop'), { key: 'ArrowLeft' });
    fireEvent.click(screen.getByText('save preview'));
    expect(await screen.findByRole('status')).toHaveTextContent('framing is preserved');
    expect(screen.getByLabelText('Move social preview crop')).toHaveAttribute('aria-valuetext', 'x 0, y 0, width 1580');
  });
});

it('uploads an asset before saving its Helmet reference and retains the crop', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => response(input === '/api/my/artifacts' ? 201 : 200, { id: 'image1', edit_id: 'e2' }));
  vi.stubGlobal('fetch', fetchMock);
  const close = vi.fn();
  const source = '<Helmet><meta name="artifactbin:og-crop" content="x=20;y=30;width=600" /></Helmet><p>x</p>';
  render(<SocialPreviewDialog id="story1" source={source} editId="e1" version={1} onClose={close} />);
  const file = new File(['image'], 'card.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Upload social preview image'), { target: { files: [file] } });
  const uploaded = await screen.findByAltText('Uploaded social preview');
  Object.defineProperty(uploaded, 'naturalWidth', { configurable: true, value: 1600 });
  Object.defineProperty(uploaded, 'naturalHeight', { configurable: true, value: 1200 });
  fireEvent.load(uploaded);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/my/artifacts');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('save preview'));
  await waitFor(() => expect(close).toHaveBeenCalled());
  const options = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(options.body as string).source).toContain('name="artifactbin:og-image" content="ref:image1"');
  expect(JSON.parse(options.body as string).source).toContain('x=20;y=30;width=600');
});

it('removing an uploaded image restores the existing crop', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, {}));
  vi.stubGlobal('fetch', fetchMock);
  const source = '<Helmet><meta name="artifactbin:og-crop" content="x=20;y=30;width=600" /><meta name="artifactbin:og-image" content="ref:image1" /></Helmet><p>x</p>';
  render(<SocialPreviewDialog id="story1" source={source} editId="e1" version={1} onClose={() => {}} />);
  fireEvent.click(screen.getByText('use document framing'));
  loadOverview();
  fireEvent.click(screen.getByText('save preview'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const saved = JSON.parse(fetchMock.mock.calls[0][1]?.body as string).source;
  expect(saved).not.toContain('og-image');
  expect(saved).toContain('x=20;y=30;width=600');
});

it('keeps the current choice and allows retry after upload failure', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response(413, { error: 'image_too_large' })));
  render(<SocialPreviewDialog id="story1" source='<Helmet><meta name="artifactbin:og-image" content="ref:image1" /></Helmet><p>x</p>' editId="e1" version={1} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Upload social preview image'), { target: { files: [new File(['x'], 'x.png', { type: 'image/png' })] } });
  expect(await screen.findByText('image_too_large')).toBeInTheDocument();
  expect(screen.getByAltText('Uploaded social preview')).toBeInTheDocument();
  expect(screen.getByText('replace image')).toBeEnabled();
});

it('pans and resizes an uploaded image, saving independent bounds and reopening them', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, {}));
  vi.stubGlobal('fetch', fetchMock);
  const source = '<Helmet><meta name="artifactbin:og-image" content="ref:image1" /><meta name="artifactbin:og-crop" content="x=0;y=900;width=800" /><meta name="artifactbin:og-image-crop" content="x=400;y=200;width=800" /></Helmet><p>x</p>';
  render(<SocialPreviewDialog id="story1" source={source} editId="e1" version={1} onClose={() => {}} />);
  const image = screen.getByAltText('Uploaded social preview');
  expect(image).toHaveAttribute('src', '/a/story1/export?mode=preview&image=1&v=1&attempt=0');
  Object.defineProperty(image, 'naturalWidth', { value: 1600 });
  Object.defineProperty(image, 'naturalHeight', { value: 1200 });
  fireEvent.load(image);
  const frame = screen.getByLabelText('Move social preview crop');
  expect(frame).toHaveAttribute('aria-valuetext', 'x 400, y 200, width 800');
  fireEvent.keyDown(frame, { key: 'ArrowDown' });
  fireEvent.keyDown(screen.getByLabelText('Resize social preview crop'), { key: 'ArrowLeft' });
  expect(frame).toHaveAttribute('aria-valuetext', 'x 400, y 210, width 780');
  expect(document.querySelector('img[src*="focus=1"]')).toBeNull();
  fireEvent.click(screen.getByText('save preview'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const saved = JSON.parse(fetchMock.mock.calls[0][1]?.body as string).source;
  expect(saved).toContain('name="artifactbin:og-image-crop" content="x=400;y=210;width=780"');
  expect(saved).toContain('name="artifactbin:og-crop" content="x=0;y=900;width=800"');
});

it('resets an image to its centered crop without clearing document framing', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(200, {}));
  vi.stubGlobal('fetch', fetchMock);
  render(<SocialPreviewDialog id="story1" source='<Helmet><meta name="artifactbin:og-image" content="ref:image1" /><meta name="artifactbin:og-image-crop" content="x=400;y=200;width=800" /><meta name="artifactbin:og-crop" content="x=0;y=900;width=800" /></Helmet><p>x</p>' editId="e1" version={1} onClose={() => {}} />);
  const image = screen.getByAltText('Uploaded social preview');
  Object.defineProperty(image, 'naturalWidth', { value: 1600 });
  Object.defineProperty(image, 'naturalHeight', { value: 1200 });
  fireEvent.load(image);
  fireEvent.click(screen.getByLabelText('Reset social preview'));
  expect(screen.getByLabelText('Move social preview crop')).toHaveAttribute('aria-valuetext', 'x 0, y 180, width 1600');
  fireEvent.click(screen.getByText('save preview'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const saved = JSON.parse(fetchMock.mock.calls[0][1]?.body as string).source;
  expect(saved).not.toContain('og-image-crop');
  expect(saved).toContain('og-crop');
});

it('starts a replacement image with fresh centered framing', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => response(200, input === '/api/my/artifacts' ? { id: 'image2' } : {}));
  vi.stubGlobal('fetch', fetchMock);
  render(<SocialPreviewDialog id="story1" source='<Helmet><meta name="artifactbin:og-image" content="ref:image1" /><meta name="artifactbin:og-image-crop" content="x=400;y=200;width=800" /></Helmet><p>x</p>' editId="e1" version={1} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('Upload social preview image'), { target: { files: [new File(['x'], 'replacement.png', { type: 'image/png' })] } });
  await waitFor(() => expect(screen.getByAltText('Uploaded social preview')).toHaveAttribute('src', '/a/image2/raw?attempt=0'));
  const image = screen.getByAltText('Uploaded social preview');
  Object.defineProperty(image, 'naturalWidth', { value: 1600 });
  Object.defineProperty(image, 'naturalHeight', { value: 105 });
  fireEvent.load(image);
  expect(screen.getByLabelText('Move social preview crop')).toHaveAttribute('aria-valuetext', 'x 700, y 0, width 200');
  fireEvent.click(screen.getByText('save preview'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const saved = JSON.parse(fetchMock.mock.calls[1][1]?.body as string).source;
  expect(saved).toContain('content="ref:image2"');
  expect(saved).toContain('content="x=700;y=0;width=200"');
});
