/** lib/html-systems through its index: the runtime-class rule, the font faces and manifest, and the themes a stored row resolves to. */
import { describe, expect, it } from 'vitest';
import {resolveStoredStoryDesign} from '../story-themes';

describe('themes', () => {
  it('resolves a stored theme or design system, and turns an unknown name into unthemed', () => {
    expect(resolveStoredStoryDesign('organic', 'dark')).toEqual({ theme: 'organic', colorMode: 'dark' });
    expect(resolveStoredStoryDesign('volta', undefined)).toEqual({ theme: 'volta', colorMode: null });
    expect(resolveStoredStoryDesign('retired-theme', 'light')).toEqual({ theme: null, colorMode: 'light' });
    expect(resolveStoredStoryDesign(null, null)).toEqual({ theme: null, colorMode: null });
  });
});
