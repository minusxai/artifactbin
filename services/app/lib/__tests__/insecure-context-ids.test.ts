/**
 * A document framed on its own origin runs at `http://<hex>.lvh.me` in development and in the gates, and the app page
 * at `http://app.lvh.me`: neither is a secure context, so `crypto.randomUUID` (secure contexts only) is undefined there
 * and the editor, the save preparer and the comment layer threw on first use. Browser code takes ids from
 * lib/story-runtime/runtime-id (`getRandomValues`, available everywhere) instead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = path.resolve(__dirname, '../..');
const BROWSER_TREES = ['lib/editor-v2', 'lib/story-runtime', 'lib/story/graph', 'lib/islands', 'lib/capture', 'solid'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sources(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

describe('browser code outside a secure context', () => {
  it('takes its ids from runtimeId, never crypto.randomUUID', () => {
    const offenders = BROWSER_TREES.flatMap((tree) => sources(path.join(APP, tree)))
      .filter((file) => /\bcrypto\.randomUUID\s*\(/.test(readFileSync(file, 'utf8').replace(/^\s*(\*|\/\/).*$/gm, '')))
      .map((file) => path.relative(APP, file));
    expect(offenders).toEqual([]);
  });
});
