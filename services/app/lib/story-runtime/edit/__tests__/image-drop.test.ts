/**
 * Getting an image out of a paste or a drop — PURE, and one function for both,
 * because a ClipboardEvent and a DragEvent differ only in which property holds
 * the DataTransfer.
 *
 * The case that matters most is the NEGATIVE one: pasting ordinary text must
 * yield nothing. A paste handler that swallows every paste breaks typing in a
 * document, which is the common act; inserting an image is the rare one.
 */
import { describe, expect, it } from 'vitest';
import { imageFileFromTransfer } from '../image-drop';

const file = (name: string, type: string) => new File(['x'], name, { type });

/** A DataTransfer as the two events expose it: `items` and/or `files`. */
const transfer = (
  items: { kind: string; type: string; file: File | null }[],
  files: File[] = [],
): DataTransfer => ({
  items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file })),
  files,
} as unknown as DataTransfer);

describe('imageFileFromTransfer', () => {
  it('takes a pasted image', () => {
    const png = file('clip.png', 'image/png');
    expect(imageFileFromTransfer(transfer([{ kind: 'file', type: 'image/png', file: png }]))).toBe(png);
  });

  it('takes a dropped image, which arrives on `files` rather than `items`', () => {
    const jpg = file('photo.jpg', 'image/jpeg');
    expect(imageFileFromTransfer(transfer([], [jpg]))).toBe(jpg);
  });

  it('IGNORES a plain-text paste — the common act must not be swallowed', () => {
    expect(imageFileFromTransfer(transfer([{ kind: 'string', type: 'text/plain', file: null }]))).toBeNull();
    expect(imageFileFromTransfer(transfer([
      { kind: 'string', type: 'text/plain', file: null },
      { kind: 'string', type: 'text/html', file: null },
    ]))).toBeNull();
  });

  it('ignores a non-image file — this door inserts images, not attachments', () => {
    expect(imageFileFromTransfer(transfer([{ kind: 'file', type: 'application/pdf', file: file('a.pdf', 'application/pdf') }]))).toBeNull();
    expect(imageFileFromTransfer(transfer([], [file('a.zip', 'application/zip')]))).toBeNull();
  });

  it('finds the image among mixed entries — a rich paste carries text alongside it', () => {
    const png = file('c.png', 'image/png');
    expect(imageFileFromTransfer(transfer([
      { kind: 'string', type: 'text/html', file: null },
      { kind: 'file', type: 'image/png', file: png },
    ]))).toBe(png);
  });

  it('falls through to `files` when an item claims to be a file but yields none', () => {
    const png = file('c.png', 'image/png');
    expect(imageFileFromTransfer(transfer([{ kind: 'file', type: 'image/png', file: null }], [png]))).toBe(png);
  });

  it('answers null for nothing at all, rather than throwing', () => {
    expect(imageFileFromTransfer(null)).toBeNull();
    expect(imageFileFromTransfer(undefined)).toBeNull();
    expect(imageFileFromTransfer(transfer([], []))).toBeNull();
    expect(imageFileFromTransfer({} as DataTransfer)).toBeNull();
  });

  it('accepts every image type the upload door accepts', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']) {
      const f = file('x', type);
      expect(imageFileFromTransfer(transfer([], [f])), type).toBe(f);
    }
  });
});
