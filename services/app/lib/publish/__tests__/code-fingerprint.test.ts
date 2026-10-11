/**
 * The identity of the code a validator names (lib/publish/prepared/revalidation.server codeFingerprint): the content of the
 * bundle a production server runs from, equal on every instance of one build, and a fresh value for unbundled code.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeFingerprint } from '../prepared/revalidation.server';

const bundleAt = (dir: string, name: string, text: string) => {
  const file = path.join(dir, name);
  writeFileSync(file, text);
  return pathToFileURL(file).href;
};
const identityOf = (url: string) => codeFingerprint(url)[2]!;

describe('codeFingerprint', () => {
  it('names a bundle by its content: the same on every instance and under any path, different when any byte of it is', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
    const a = bundleAt(dir, 'server.mjs', 'export const server = 1;');
    const copy = bundleAt(mkdtempSync(path.join(os.tmpdir(), 'bundle-')), 'elsewhere.mjs', 'export const server = 1;');
    const changed = bundleAt(dir, 'next.mjs', 'export const server = 2;');
    expect(identityOf(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(identityOf(a)).toBe(identityOf(copy));
    expect(identityOf(a)).not.toBe(identityOf(changed));
  });

  it('is a new identity for code that runs unbundled (a dev server, a test), and stable for the module that asks', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
    const source = bundleAt(dir, 'module.ts', 'export {};');
    expect(identityOf(source)).toMatch(/^unbundled:/);
    expect(identityOf(source)).not.toBe(identityOf(source));
    expect(codeFingerprint()[2]).toBe(codeFingerprint()[2]);
  });
});
