/**
 * The pre-paint theme stamp: an explicit choice from the toggle wins; with none,
 * the device's own light/dark setting decides.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/page-styles';

const run = (stored: string | null, systemDark: boolean) => {
  delete document.documentElement.dataset.theme;
  if (stored === null) localStorage.removeItem('mx_theme'); else localStorage.setItem('mx_theme', stored);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: systemDark && query === '(prefers-color-scheme: dark)' }));
  new Function(THEME_BOOTSTRAP_SCRIPT)();
  return document.documentElement.dataset.theme ?? 'light';
};

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); document.cookie = 'mx_theme=; path=/; max-age=0'; delete document.documentElement.dataset.theme; });

it('follows the device setting when the reader has not chosen', () => {
  expect(run(null, true)).toBe('dark');
  expect(run(null, false)).toBe('light');
});

it('keeps an explicit choice over the device setting', () => {
  expect(run('light', true)).toBe('light');
  expect(run('dark', false)).toBe('dark');
});

it('hands a pick stored before the cookie existed to the app\'s server, and never writes one for the device setting', () => {
  document.cookie = 'mx_theme=; path=/; max-age=0';
  run(null, true);
  expect(document.cookie).not.toMatch(/mx_theme=/);
  run('dark', false);
  expect(document.cookie).toMatch(/(?:^|; )mx_theme=dark(?:;|$)/);
});
