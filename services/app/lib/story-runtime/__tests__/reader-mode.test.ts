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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyColorMode, chooseTheme, persistReaderMode, readerMode, takeReloadAnchor, writeReloadAnchor,
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

describe('applyColorMode: the one colour-mode writer, the reader\'s choice beats the author\'s', () => {
  const cases: Array<{ name: string; was: string; reader: 'light' | 'dark' | null; author?: 'light' | 'dark'; is: string }> = [
    { name: 'a reader override beats the author', was: 'light', reader: 'dark', author: 'light', is: 'dark' },
    { name: 'a reader override beats the author (the other way)', was: 'dark', reader: 'light', author: 'dark', is: 'light' },
    { name: 'an author change with no override applies', was: 'light', reader: null, author: 'dark', is: 'dark' },
    { name: 'an author change back to light with no override applies', was: 'dark', reader: null, author: 'light', is: 'light' },
    { name: 'a reader choice alone applies', was: 'light', reader: 'dark', is: 'dark' },
    { name: 'neither leaves what was drawn', was: 'dark', reader: null, is: 'dark' },
    { name: 'other classes stay', was: 'mx-story light', reader: 'dark', is: 'mx-story dark' },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const el = document.createElement('div');
      el.className = c.was;
      applyColorMode(el, c.reader, c.author);
      expect(el.className).toBe(c.is);
    });
  }

  it('a missing element is a no-op, never a throw', () => {
    expect(() => applyColorMode(null, 'dark')).not.toThrow();
    expect(() => applyColorMode(undefined, null, 'light')).not.toThrow();
  });
});

describe('chooseTheme: the app shell\'s stored preference', () => {
  beforeEach(() => { delete document.documentElement.dataset.theme; localStorage.clear(); });

  it('dark stamps data-theme and stores mx_theme; light clears the stamp and stores light', () => {
    chooseTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('mx_theme')).toBe('dark');
    chooseTheme('light');
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('mx_theme')).toBe('light');
  });

  it('a storage that throws (private mode, an opaque origin) still stamps the page', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    try {
      expect(() => chooseTheme('dark')).not.toThrow();
      expect(document.documentElement.dataset.theme).toBe('dark');
    } finally { set.mockRestore(); }
  });
});
