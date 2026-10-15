import {readFileSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {encodePng} from '../png';

afterEach(() => { vi.restoreAllMocks(); });

describe('encodePng', () => {
  it('returns the canvas PNG bytes at once, never through the idle-scheduled toBlob', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 255, 128]);
    const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(`data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob');
    const blob = encodePng(document.createElement('canvas'));
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(toBlob).not.toHaveBeenCalled();
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('refuses a canvas with no pixels instead of sending an empty image', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:,');
    expect(() => encodePng(document.createElement('canvas'))).toThrow('no pixels');
  });

  it('is the only way the app encodes a canvas', () => {
    const app = path.resolve(import.meta.dirname, '../../..');
    const sources: string[] = [];
    const walk = (directory: string) => {
      for (const name of readdirSync(directory)) {
        if (name === 'node_modules' || name === '__tests__' || name === 'public' || name === 'dist') continue;
        const file = path.join(directory, name);
        if (statSync(file).isDirectory()) walk(file);
        else if (/\.(ts|tsx)$/.test(name)) sources.push(file);
      }
    };
    for (const root of ['lib', 'solid', 'web']) walk(path.join(app, root));
    const encoders = sources.filter(file => /\.(toBlob|convertToBlob)\(/.test(readFileSync(file, 'utf8').replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')));
    expect(encoders.map(file => path.relative(app, file))).toEqual([]);
  });
});
