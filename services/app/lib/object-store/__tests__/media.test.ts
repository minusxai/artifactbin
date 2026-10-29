/**
 * lib/object-store's media doors, through its index: images and PDFs stored under their content address in the
 * configured store and read back (an image's small variant only at its exact width), a PDF row's metadata and
 * download name, the content types accepted, and the prepared-object staging a publish writes through.
 */
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_CONTENT_TYPES, PDF_CONTENT_TYPE, loadImage, loadPdfStream, objectKey, objectStore, pdfFilename, pdfMetaOf, prepareObjects, storeImage, storePdf,
} from '@/lib/object-store';

const text = async (stream: Readable) => { let out = ''; for await (const chunk of stream) out += chunk.toString(); return out; };

describe('images', () => {
  it('stores by content address in the configured store and reads back with its type', async () => {
    expect(objectStore()).toBe(objectStore());
    const png = Buffer.from(`png-${Date.now()}`);
    const stored = await storeImage(png, 'image/png');
    expect(stored).toEqual({ objectKey: objectKey('image', png), bytes: png.length });
    expect(await loadImage({ meta: { objectKey: stored.objectKey, contentType: 'image/png' } })).toEqual({ body: png, contentType: 'image/png' });
    expect(await loadImage({ meta: { objectKey: stored.objectKey } })).toMatchObject({ contentType: 'application/octet-stream' });
  });

  it('serves the small variant only at its exact width, and nothing for a row without an object', async () => {
    const full = await storeImage(Buffer.from(`full-${Date.now()}`), 'image/jpeg');
    const small = await storeImage(Buffer.from(`small-${Date.now()}`), 'image/webp');
    const meta = { objectKey: full.objectKey, contentType: 'image/jpeg', smallObjectKey: small.objectKey, smallWidth: 640 };
    expect((await loadImage({ meta }, { width: '640' }))!.body.toString()).toMatch(/^small-/);
    expect((await loadImage({ meta }, { width: 641 }))!.body.toString()).toMatch(/^full-/);
    expect((await loadImage({ meta }, { width: null }))!.body.toString()).toMatch(/^full-/);
    expect(await loadImage({ meta: null })).toBeNull();
    expect(await loadImage({ meta: { objectKey: '' } })).toBeNull();
    expect(IMAGE_CONTENT_TYPES).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);
  });

  it('writes through any store the caller passes', async () => {
    const puts: [string, string][] = [];
    const location = await storeImage(Buffer.from('x'), 'image/gif', { put: async (key, _body, type) => { puts.push([key, type!]); } });
    expect(puts).toEqual([[location.objectKey, 'image/gif']]);
  });
});

describe('PDFs', () => {
  it('stores and streams whole or by range', async () => {
    const pdf = Buffer.from(`%PDF-1.7 ${Date.now()}`);
    const stored = await storePdf(pdf);
    expect(stored).toEqual({ objectKey: objectKey('pdf', pdf), bytes: pdf.length });
    const meta = pdfMetaOf({ meta: { ...stored, pages: 2, sha256: 'abc' } })!;
    expect(meta).toEqual({ objectKey: stored.objectKey, bytes: pdf.length, contentType: PDF_CONTENT_TYPE, sha256: 'abc', pages: 2 });
    expect(await text(await loadPdfStream(meta))).toBe(pdf.toString());
    expect(await text(await loadPdfStream(meta, { start: 0, end: 3 }))).toBe('%PDF');
  });

  it('reads metadata defensively and names a download safely', () => {
    expect(pdfMetaOf({ meta: null })).toBeNull();
    expect(pdfMetaOf({ meta: { objectKey: 7 } })).toBeNull();
    expect(pdfMetaOf({ meta: { objectKey: 'k', bytes: '9', pages: '2' } })).toEqual({ objectKey: 'k', bytes: 0, contentType: PDF_CONTENT_TYPE });
    expect(pdfFilename('Q3 "Report"; final\\draft', 'abc')).toBe("Q3 Report finaldraft.pdf");
    expect(pdfFilename('two\nlines', 'abc')).toBe('two lines.pdf');
    expect(pdfFilename(null, 'abc')).toBe('abc.pdf');
    expect(pdfFilename('   ', 'abc')).toBe('abc.pdf');
  });
});

describe('prepared objects', () => {
  it('stages writes once in order, reads staged bytes first, and refuses a key reused for different bytes', async () => {
    const { store, objects } = prepareObjects({ get: async key => Buffer.from(`underlying:${key}`) });
    await store.put('a', Buffer.from('one'), 'text/plain');
    await store.put('a', Buffer.from('one'), 'text/plain');
    await store.put('b', Buffer.from('two'));
    expect(objects.map(o => [o.key, o.bytes.toString(), o.contentType])).toEqual([['a', 'one', 'text/plain'], ['b', 'two', undefined]]);
    expect((await store.get('a')).toString()).toBe('one');
    expect((await store.get('c')).toString()).toBe('underlying:c');
    await expect(store.put('a', Buffer.from('changed'), 'text/plain')).rejects.toThrow('Prepared object key collision');
    await expect(store.put('a', Buffer.from('one'), 'text/html')).rejects.toThrow('Prepared object key collision');
  });
});
