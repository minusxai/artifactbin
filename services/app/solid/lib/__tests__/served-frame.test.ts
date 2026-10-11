import { afterEach, beforeEach, expect, it } from 'vitest';
import { captureServedFrame, claimServedPath, dropServedFrameOnRoute } from '@/solid/lib/served-frame';

/**
 * The address this document load was served at is claimed ONCE, by the first page drawn there, and only until the
 * client navigates away: a later return to that address (Back to a document the load served) is a client navigation,
 * not the server's own answer, and must cross to the server like any other.
 */
beforeEach(() => { window.history.replaceState(null, '', '/a/doc001'); captureServedFrame(); });
afterEach(() => { dropServedFrameOnRoute('/elsewhere'); window.history.replaceState(null, '', '/'); });

it('is claimed once, for the served address only', () => {
  expect(claimServedPath('/a/other')).toBe(false);
  expect(claimServedPath('/a/doc001')).toBe(true);
  expect(claimServedPath('/a/doc001')).toBe(false);
});

it('is void once the client has navigated away, even if nothing claimed it', () => {
  dropServedFrameOnRoute('/login');
  expect(claimServedPath('/a/doc001')).toBe(false);
});
