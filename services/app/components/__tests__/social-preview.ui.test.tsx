import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SocialPreviewDialog from '../SocialPreviewDialog';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const loadOverview = () => {
  const image = screen.getByAltText('Full artifact overview') as HTMLImageElement;
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
    expect(screen.getByAltText('Full artifact overview')).toHaveAttribute(
      'src', '/a/story1/export?mode=preview&format=jpg&v=4',
    );
    loadOverview();
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
