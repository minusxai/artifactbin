/** The reader's light/dark pick across the app and its documents (chooseTheme, storedTheme). */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chooseTheme, storedTheme } from '../../html-reader/reader-mode';
import { READER_MODE_PARAM, withReaderMode } from '../../html-reader/contract';

beforeEach(() => { window.name = ''; window.history.replaceState(null, '', '/'); });

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

/**
 * THE READER'S STORED PICK, ACROSS ORIGINS. The app origin keeps one pick (`mx_theme`: storage for the shell's pre-paint
 * stamp, a cookie for its server); the document on its own origin is told it in its first URL (READER_MODE_PARAM), the
 * channel that survives the frame's reloads, and keeps the address current when the reader picks again in the visit.
 */
describe('the reader\'s pick across the app and its documents', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'mx_theme=; path=/; max-age=0';
    delete document.documentElement.dataset.theme;
  });

  it('chooseTheme stores the pick where the shell\'s stamp and the app\'s server both read it', () => {
    chooseTheme('dark');
    expect(localStorage.getItem('mx_theme')).toBe('dark');
    expect(document.cookie).toMatch(/(?:^|; )mx_theme=dark(?:;|$)/);
    expect(document.documentElement.dataset.theme).toBe('dark');
    chooseTheme('light');
    expect(document.cookie).toMatch(/(?:^|; )mx_theme=light(?:;|$)/);
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('storedTheme is the explicit pick only: none for a reader who never picked, or for junk', () => {
    expect(storedTheme()).toBeNull();
    localStorage.setItem('mx_theme', 'sepia');
    expect(storedTheme()).toBeNull();
    chooseTheme('dark');
    expect(storedTheme()).toBe('dark');
  });

  it('withReaderMode puts exactly one pick in a search, or takes it out', () => {
    expect(withReaderMode('', 'dark')).toBe(`?${READER_MODE_PARAM}=dark`);
    expect(withReaderMode(`?$a=1&${READER_MODE_PARAM}=light`, 'dark')).toBe(`?$a=1&${READER_MODE_PARAM}=dark`);
    expect(withReaderMode(`?$a=1&${READER_MODE_PARAM}=light`, null)).toBe('?$a=1');
    expect(withReaderMode(`?${READER_MODE_PARAM}=dark`, null)).toBe('');
  });
});
