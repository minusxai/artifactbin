import { expect, it } from 'vitest';
import { localPublicationPath, publicationBody } from '../selection';
const file = (path: string, value: string) => ({ path, bytes: new TextEncoder().encode(value), contentType: 'text/plain' });
it('keeps explicit project paths and binary bytes while omitting the entry file', () => {
  const body = publicationBody({ entryPath: 'docs/page.html', html: '<p>Current source</p>', files: [file('docs/page.html', 'old source'), { path: 'assets/photo.png', bytes: new Uint8Array([0, 255, 128]), contentType: 'image/png' }] });
  expect(body.visibility).toBe('private');
  expect(body.publicationBundle.files).toEqual([{ path: 'assets/photo.png', contentType: 'image/png', base64: 'AP+A' }]);
  expect(body.html).toBe('<p>Current source</p>');
});
it('refuses traversal, absolute paths, URL credentials and duplicate selected names', () => {
  for (const path of ['../x', '/Users/private/file', 'C:\\file', 'a/../b', 'a//b', 'https://user:secret@example.test/x', 'a?token=secret']) expect(() => localPublicationPath(path)).toThrow();
  expect(() => publicationBody({ entryPath: 'page.html', html: '<p>x</p>', files: [file('asset.txt', 'one'), file('asset.txt', 'two')] })).toThrow(/More than one/);
});
it('refuses oversized selections before encoding or publication', () => {
  expect(() => publicationBody({ entryPath: 'page.html', html: '<p>x</p>', files: [{ path: 'huge.txt', bytes: new Uint8Array(4_000_001), contentType: 'text/plain' }] })).toThrow(/4 MB/);
  expect(() => publicationBody({ entryPath: 'page.html', html: '<p>x</p>', files: Array.from({ length: 100 }, (_, n) => file(`${n}.txt`, 'x')) })).toThrow(/99/);
});
