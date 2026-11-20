/** The frame's navigation target (lib/html-reader/frame-navigation): only an address on this page's own origin. */
// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { appNavigationTarget } from '../frame-navigation';

it('names the target on this page\'s own origin', () => {
  expect(appNavigationTarget(window, '/a/B?x=1#h')?.href).toBe(`${window.location.origin}/a/B?x=1#h`);
  expect(appNavigationTarget(window, '//elsewhere.test/')).toBeNull();
});
