/**
 * THE READER ACTIONS the Solid pages share, over the REAL chrome markup the server renders
 * (lib/story/reader-chrome): a face whose picture fails shows its initial, and a light/dark choice
 * flips the document and the choice buttons together.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderReaderChrome, type ReaderChromeInput } from '@/lib/story/reader-chrome';
import { STORY_MODE_HOOK } from '@/lib/story-runtime/contract';
import { applyReaderChoice, wireFaceFallback } from '@/lib/story-runtime/reader-actions';

function mount(over: Partial<ReaderChromeInput> = {}) {
  document.body.innerHTML = '<div id="mx-story-root"><p>the document</p></div>'
    + renderReaderChrome({ share: true, artifactId: 'ab12cd', title: 'Quarterly review', author: { username: 'ada' }, ...over });
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark', 'light');
  delete (window as unknown as Record<string, unknown>)[STORY_MODE_HOOK];
  vi.restoreAllMocks();
});

describe('wireFaceFallback', () => {
  it('shows the initial, never a broken picture, when a face fails to load', () => {
    mount({ viewer: { id: 'usr_ada', name: 'ada', image: '/gone.png' }, author: { username: 'ada', id: 'usr_ada', image: '/gone-too.png' } });
    wireFaceFallback(document);
    const faces = Array.from(document.querySelectorAll<HTMLElement>('.mx-reader-face'));
    expect(faces).toHaveLength(2);
    for (const face of faces) face.querySelector('img')!.dispatchEvent(new Event('error'));
    for (const face of faces) {
      expect(face.querySelector('img')).toBeNull();
      expect(face.querySelector('.mx-reader-face-initial')!.textContent).toBe('A');
    }
  });

  it('leaves a picture alone once unwired', () => {
    mount({ viewer: { id: 'usr_ada', name: 'ada', image: '/gone.png' } });
    wireFaceFallback(document)();
    const img = document.querySelector('.mx-reader-face img')!;
    img.dispatchEvent(new Event('error'));
    expect(img.isConnected).toBe(true);
  });
});

describe('applyReaderChoice', () => {
  it('flips the reader mode, the choice buttons and the hydrated runtime together', () => {
    mount();
    const hook = vi.fn();
    (window as unknown as Record<string, unknown>)[STORY_MODE_HOOK] = hook;
    applyReaderChoice(window, document, 'dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.querySelector('[data-mx-mode-choice="dark"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-mx-mode-choice="light"]')!.getAttribute('aria-pressed')).toBe('false');
    expect(hook).toHaveBeenLastCalledWith('dark');
    applyReaderChoice(window, document, 'light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.querySelector('[data-mx-mode-choice="light"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(hook).toHaveBeenLastCalledWith('light');
  });
});
