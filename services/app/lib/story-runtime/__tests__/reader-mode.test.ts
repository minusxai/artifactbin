/**
 * The reader's mode override — per-visit state in `window.name`.
 *
 * A served document runs at an OPAQUE origin (sandbox without
 * allow-same-origin): every storage API throws, so the only thing that
 * survives a live reload is `window.name`. One envelope (`mx:doc:`) carries
 * both the reload anchor and the mode override; these tests pin the merge
 * semantics — consuming the anchor must never drop the mode, and vice versa.
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyReaderMode, persistReaderMode, readerMode, takeReloadAnchor, writeReloadAnchor,
} from '../reader-mode';

const win = () => window as Window & { name: string };

beforeEach(() => { window.name = ''; });

describe('the mx:doc window.name envelope', () => {
  it('round-trips a mode override', () => {
    expect(readerMode(win())).toBeNull();
    persistReaderMode(win(), 'dark');
    expect(readerMode(win())).toBe('dark');
    persistReaderMode(win(), 'light');
    expect(readerMode(win())).toBe('light');
    persistReaderMode(win(), null);
    expect(readerMode(win())).toBeNull();
  });

  it('a reload anchor and a mode coexist; taking the anchor preserves the mode', () => {
    persistReaderMode(win(), 'dark');
    writeReloadAnchor(win(), { path: '0.1', fraction: 0.5 });
    expect(takeReloadAnchor(win())).toEqual({ path: '0.1', fraction: 0.5 });
    // One reload, one restore — but the reader's mode is not a reload detail.
    expect(takeReloadAnchor(win())).toBeNull();
    expect(readerMode(win())).toBe('dark');
  });

  it('persisting a mode never clobbers a pending anchor', () => {
    writeReloadAnchor(win(), { path: '0.2', fraction: 0.25 });
    persistReaderMode(win(), 'light');
    expect(takeReloadAnchor(win())).toEqual({ path: '0.2', fraction: 0.25 });
  });

  it('junk in window.name reads as no state, never a throw', () => {
    window.name = 'mx:doc:{not json';
    expect(readerMode(win())).toBeNull();
    expect(takeReloadAnchor(win())).toBeNull();
    window.name = 'someone-elses-window-name';
    expect(readerMode(win())).toBeNull();
  });

  it('still consumes the legacy bare-anchor prefix a pre-envelope document wrote', () => {
    window.name = 'mx:anchor:' + JSON.stringify({ path: '0.3', fraction: 0.75 });
    expect(takeReloadAnchor(win())).toEqual({ path: '0.3', fraction: 0.75 });
    expect(window.name).toBe('');
  });
});

describe('applyReaderMode', () => {
  it('flips the mode classes on the document element', () => {
    document.documentElement.className = 'light';
    applyReaderMode(document, 'dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    applyReaderMode(document, 'light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
