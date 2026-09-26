/**
 * THE INSERT / REPLACE IMAGE DIALOG. Two ways in, both obvious: a file (drop
 * zone or chooser) and a URL. A choice is uploaded at once and previewed; the
 * document changes only when Insert / Replace is pressed. Refusals are
 * sentences in the dialog. Escape and Cancel leave without a trace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ImageDialog, { type ImageChoice } from '../ImageDialog';
import { withHttpBackend } from '@/test/helpers/artifact-backend';

const png = (name = 'a.png', type = 'image/png', size = 10) => {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

function mount(mode: 'insert' | 'replace' = 'insert', answer: ImageChoice = { ok: true, image: { id: 'New222', rawUrl: '/a/New222/raw?v=1' } }) {
  let resolve: (v: ImageChoice) => void = () => {};
  const pending = new Promise<ImageChoice>((r) => { resolve = r; });
  const props = {
    onUploadFile: vi.fn(() => pending),
    onImportUrl: vi.fn(async () => answer),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
  };
  render(withHttpBackend('Doc111', <ImageDialog mode={mode} {...props} />));
  return { ...props, finishUpload: async (v: ImageChoice = answer) => { await act(async () => { resolve(v); await pending; }); } };
}

describe('ImageDialog', () => {
  it('is a labelled dialog offering Upload and From URL, with the accepted types and limit', () => {
    mount();
    const dialog = screen.getByRole('dialog', { name: 'Insert image' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('region', { name: 'Upload' }).textContent).toContain('Drop an image here or choose a file');
    expect(dialog.textContent).toMatch(/PNG, JPEG, WebP, GIF or SVG · up to \d+ MB/);
    expect(screen.getByRole('region', { name: 'From URL' })).toContainElement(screen.getByLabelText('Image URL'));
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'choose a file' }));
  });

  it('uploads a chosen file at once, shows progress, then a preview, and inserts only on Insert', async () => {
    const d = mount();
    const file = png();
    await act(async () => { fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [file] } }); });
    expect(d.onUploadFile).toHaveBeenCalledWith(file);
    expect(screen.getByRole('progressbar', { name: 'Uploading…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();
    await d.finishUpload();
    // The preview is the SERVER's copy: proof the upload landed, and never a string from the page.
    expect(screen.getByAltText('Preview of the chosen image')).toHaveAttribute('src', '/a/New222/raw?v=1');
    expect(d.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(d.onConfirm).toHaveBeenCalledWith({ id: 'New222', rawUrl: '/a/New222/raw?v=1' });
  });

  it('takes a file dropped on the zone', async () => {
    const d = mount();
    const file = png();
    await act(async () => { fireEvent.drop(screen.getByLabelText('Image drop zone'), { dataTransfer: { files: [file] } }); });
    expect(d.onUploadFile).toHaveBeenCalledWith(file);
  });

  it('shows a refusal as a sentence, and offers nothing to insert', async () => {
    const d = mount();
    await act(async () => { fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [png()] } }); });
    await d.finishUpload({ ok: false, error: 'That image is too large to upload.' });
    expect(screen.getByRole('alert').textContent).toBe('That image is too large to upload.');
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();
  });

  it('refuses a file of the wrong type or size before uploading it', async () => {
    const d = mount();
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [png('a.pdf', 'application/pdf')] } });
    expect(screen.getByRole('alert').textContent).toContain('not an image');
    fireEvent.change(screen.getByLabelText('Image file'), { target: { files: [png('big.png', 'image/png', 10 ** 9)] } });
    expect(screen.getByRole('alert').textContent).toMatch(/larger than \d+ MB/);
    expect(d.onUploadFile).not.toHaveBeenCalled();
  });

  it('imports a URL, previews what the server holds, and inserts it', async () => {
    const d = mount();
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: ' https://example.com/b.png ' } });
    await act(async () => { fireEvent.keyDown(screen.getByLabelText('Image URL'), { key: 'Enter' }); });
    expect(d.onImportUrl).toHaveBeenCalledWith('https://example.com/b.png');
    expect(screen.getByAltText('Preview of the chosen image')).toHaveAttribute('src', '/a/New222/raw?v=1');
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(d.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('previews nothing for an answer that is not an image id', async () => {
    const d = mount('insert', { ok: true, image: { id: '"><script>' } });
    fireEvent.change(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/b.png' } });
    await act(async () => { fireEvent.click(screen.getByLabelText('Import image from URL')); });
    expect(d.onImportUrl).toHaveBeenCalled();
    expect(screen.queryByAltText('Preview of the chosen image')).toBeNull();
    expect(screen.getByRole('button', { name: 'Insert' })).toBeDisabled();
    expect(screen.getByRole('alert').textContent).toContain('Could not');
  });

  it('says what is missing when Import is pressed with no URL', () => {
    const d = mount();
    fireEvent.click(screen.getByLabelText('Import image from URL'));
    expect(screen.getByRole('alert').textContent).toContain('address of an image');
    expect(d.onImportUrl).not.toHaveBeenCalled();
  });

  it('Escape, Cancel and the close button leave without inserting', () => {
    const d = mount();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(d.onClose).toHaveBeenCalledTimes(3);
    expect(d.onConfirm).not.toHaveBeenCalled();
  });

  it('is the same dialog for replacing, titled and labelled for it', () => {
    mount('replace');
    expect(screen.getByRole('dialog', { name: 'Replace image' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
  });
});
