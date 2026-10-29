import { describe, expect, it } from 'vitest';
import { readSelectedLocalFiles } from '..';

const file = (name: string, bytes: Uint8Array | string, type = '', relative = '') => {
  const made = new File([bytes], name, { type });
  if (relative) Object.defineProperty(made, 'webkitRelativePath', { value: relative });
  return made;
};

describe('readSelectedLocalFiles', () => {
  it('strips the folder picker selection root, keeps nested paths, bytes and content types', async () => {
    const files = await readSelectedLocalFiles([
      file('index.html', '<p>hi</p>', 'text/html', 'project/index.html'),
      file('logo.png', new Uint8Array([0, 255, 1]), 'image/png', 'project/assets/logo.png'),
    ]);
    expect(files.map(f => [f.path, f.contentType])).toEqual([['index.html', 'text/html'], ['assets/logo.png', 'image/png']]);
    expect([...files[1]!.bytes]).toEqual([0, 255, 1]);
  });

  it('uses the plain file name for individually chosen files and defaults an unknown type', async () => {
    const [chosen] = await readSelectedLocalFiles([file('data ü.csv', 'a,b')]);
    expect(chosen).toMatchObject({ path: 'data ü.csv', contentType: 'application/octet-stream' });
    expect(await readSelectedLocalFiles([])).toEqual([]);
  });

  it('refuses traversal or absolute names a picker reports', async () => {
    await expect(readSelectedLocalFiles([file('x', 'x', '', 'root/../etc/passwd')])).rejects.toThrow('relative project paths');
    await expect(readSelectedLocalFiles([file('a:b', 'x')])).rejects.toThrow('relative project paths');
    await expect(readSelectedLocalFiles([file('x', 'x', '', 'root')])).rejects.toThrow('relative project paths');
  });

  it('refuses more than 100 files, a file over 4 MB and selections over 16 MB in total', async () => {
    await expect(readSelectedLocalFiles(Array.from({ length: 101 }, (_, i) => file(`f${i}.txt`, 'x')))).rejects.toThrow('at most 100 files');
    expect(await readSelectedLocalFiles(Array.from({ length: 100 }, (_, i) => file(`f${i}.txt`, 'x')))).toHaveLength(100);
    await expect(readSelectedLocalFiles([file('big.bin', new Uint8Array(4_000_001))])).rejects.toThrow('4 MB each');
    const nearly = () => file('part.bin', new Uint8Array(4_000_000));
    expect(await readSelectedLocalFiles([nearly(), nearly(), nearly(), nearly()])).toHaveLength(4);
    await expect(readSelectedLocalFiles([nearly(), nearly(), nearly(), nearly(), file('one.bin', 'x')])).rejects.toThrow('16 MB in total');
  });
});
