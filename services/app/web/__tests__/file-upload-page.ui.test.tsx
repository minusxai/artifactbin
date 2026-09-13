/**
 * /files/new — pick a file, see it, upload it into the current folder.
 *
 * The preview is the page's promise, so each accepted family is checked for
 * the element it renders into; the upload is checked for the DOOR it takes
 * (image data URL, pdf data URL, or the file triple) and for carrying the
 * folder from the address. A refused extension never reaches the network.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { FileUploadPage } from '@/web/pages/FileUpload';
import { resetRouter, router } from '@/test/setup/router';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: { user: { id: 'usr_1', email: 'owner@example.com' } } }) }));
// The 3D viewer needs WebGL and the served three bundle; here only the handoff is checked.
vi.mock('@/components/ModelPreview', () => ({ default: ({ title }: { title: string }) => <div aria-label={`3D preview of ${title}`} /> }));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The ui project stubs the navigation hooks (test/setup/router), so the
 * address is set on that double rather than on a router. */
function open(search = '') {
  router.search = new URLSearchParams(search);
  return render(<MemoryRouter><FileUploadPage /></MemoryRouter>);
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText('Choose a file'), { target: { files: [file] } });
}

function sentBody(): Record<string, unknown> {
  const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
  expect(call[0]).toBe('/api/my/artifacts');
  return JSON.parse(String(call[1].body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'art_1' }), { status: 201 })));
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:preview'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(() => {
  cleanup();
  resetRouter();
  vi.unstubAllGlobals();
});

describe('the file upload page', () => {
  it('previews a picked image and uploads it through the image door, into the folder named by the address', async () => {
    open('parent_id=fold01');
    choose(new File([PNG], 'logo.png', { type: 'image/png' }));

    expect(await screen.findByRole('img', { name: 'logo.png' })).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByLabelText('Title')).toHaveValue('logo');

    fireEvent.click(screen.getByRole('button', { name: 'upload' }));
    expect(await screen.findByLabelText('Open artifact')).toHaveAttribute('href', '/a/art_1');
    const body = sentBody();
    expect(String(body.image).startsWith('data:image/png;base64,')).toBe(true);
    expect(body.title).toBe('logo');
    expect(body.parent_id).toBe('fold01');
    expect(screen.getByLabelText('Copy file reference')).toHaveTextContent('ref:art_1');
  });

  it('hands a glb to the 3D viewer and uploads it as a file with its model content type', async () => {
    open();
    choose(new File([new Uint8Array([0x67, 0x6c, 0x54, 0x46])], 'chair.glb', { type: '' }));

    expect(await screen.findByLabelText('3D preview of chair.glb')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'upload' }));
    await screen.findByLabelText('Uploaded file');
    const body = sentBody();
    const file = body.file as { filename: string; contentType: string; base64: string };
    expect(file.filename).toBe('chair.glb');
    expect(file.contentType).toBe('model/gltf-binary');
    expect(file.base64.length).toBeGreaterThan(0);
    expect(body.parent_id).toBeNull();
  });

  it('sends a pdf through the pdf door and frames the stored copy once it is there', async () => {
    open();
    choose(new File(['%PDF-1.4'], 'deck.pdf', { type: 'application/pdf' }));
    // Before upload only a card: the app frames its own origin, not a blob.
    expect(await screen.findByLabelText('File summary of deck.pdf')).toHaveTextContent(/previews once uploaded/);
    expect(screen.queryByTitle('deck.pdf')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'upload' }));
    await screen.findByLabelText('Uploaded file');
    expect(String(sentBody().pdf).startsWith('data:application/pdf;base64,')).toBe(true);
    expect(screen.getByTitle('deck.pdf')).toHaveAttribute('src', '/a/art_1/raw');
  });

  it('shows the first lines of a text file', async () => {
    open();
    choose(new File(['name,qty\nbolt,4\n'], 'parts.csv', { type: 'text/csv' }));
    expect(await screen.findByLabelText('Preview of parts.csv')).toHaveTextContent('name,qty bolt,4');
  });

  it('gives a type the browser cannot show an icon card with a download', async () => {
    open();
    choose(new File(['PK'], 'bundle.zip', { type: 'application/zip' }));
    expect(await screen.findByLabelText('File summary of bundle.zip')).toHaveTextContent(/no preview for this type/);
    expect(screen.getByLabelText('Download bundle.zip')).toHaveAttribute('href', 'blob:preview');
  });

  it('refuses an extension no door accepts, before any request', async () => {
    open();
    choose(new File(['MZ'], 'setup.exe', { type: 'application/octet-stream' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/\.exe files are not accepted/);
    expect(screen.queryByLabelText('Title')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('surfaces the door’s refusal instead of pretending', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'file_too_large', maxBytes: 50_000_000 }), { status: 413 })));
    open();
    choose(new File([PNG], 'huge.png', { type: 'image/png' }));
    await screen.findByRole('img', { name: 'huge.png' });
    fireEvent.click(screen.getByRole('button', { name: 'upload' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too large/));
    expect(screen.queryByLabelText('Uploaded file')).toBeNull();
  });
});
