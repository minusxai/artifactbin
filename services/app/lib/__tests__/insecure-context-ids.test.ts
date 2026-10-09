/**
 * A document framed on its own origin runs at `http://<hex>.lvh.me` in development and in the gates, and the app page
 * at `http://app.lvh.me`: neither is a secure context, so `crypto.randomUUID` (secure contexts only) is undefined there
 * and the editor, the save preparer and the comment layer threw on first use. Browser code takes ids from
 * @artifactbin/utils/runtime-id (`getRandomValues`, available everywhere) instead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { runtimeId } from '@artifactbin/utils/runtime-id';

const APP = path.resolve(__dirname, '../..');
const BROWSER_TREES = ['lib/editor-v2', 'lib/story-runtime', 'lib/document', 'lib/islands', 'lib/capture', 'solid'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('browser code outside a secure context', () => {
  it('keeps runtime UUID byte grouping and v4 bits', () => {
    const random = vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.set(Array.from({ length: bytes.length }, (_, index) => index));
      return array;
    });
    try {
      expect(runtimeId()).toBe('01234567-89ab-4cde-b012-3456789abcde');
      expect((random.mock.calls[0]![0] as Uint8Array)).toHaveLength(31);
      let seed = 0;
      random.mockImplementation((array) => {
        const bytes = array as Uint8Array;
        bytes.fill(0);
        bytes[15] = seed++;
        return array;
      });
      for (const variant of ['8', '9', 'a', 'b']) expect(runtimeId().split('-')[3]![0]).toBe(variant);
    } finally {
      random.mockRestore();
    }
  });

  it('takes its ids from runtimeId, never crypto.randomUUID', () => {
    const offenders = BROWSER_TREES.flatMap((tree) => sources(path.join(APP, tree)))
      .filter((file) => /\bcrypto\.randomUUID\s*\(/.test(readFileSync(file, 'utf8').replace(/^\s*(\*|\/\/).*$/gm, '')))
      .map((file) => path.relative(APP, file));
    expect(offenders).toEqual([]);
  });
});
