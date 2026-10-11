import { afterEach, expect, it, vi } from 'vitest';
import { replaceDocument } from '@/solid/lib/document-navigation';

/**
 * Crossing from the app's address to the server's page for the SAME address. `location.replace(sameUrl#fragment)` is a
 * fragment navigation, which never loads anything: a link to `/a/<id>#edit` or a notification's `#<node>` would sit on
 * "Loading artifact…" for ever. The same address, fragment included, is a reload (the server never sees the fragment).
 */
const stubLocation = (href: string) => {
  const location = { href, replace: vi.fn(), reload: vi.fn() };
  vi.stubGlobal('location', location);
  return location;
};
afterEach(() => vi.unstubAllGlobals());

it('reloads when the target is the address already open, fragment included', () => {
  const location = stubLocation('http://app.test/a/doc001#edit');
  replaceDocument('/a/doc001#edit');
  expect(location.reload).toHaveBeenCalledTimes(1);
  expect(location.replace).not.toHaveBeenCalled();
});

it('reloads when the address has a query and no fragment', () => {
  const location = stubLocation('http://app.test/a/doc001?thread=t1');
  replaceDocument('/a/doc001?thread=t1');
  expect(location.reload).toHaveBeenCalledTimes(1);
});

it('replaces the entry when the target is another address', () => {
  const location = stubLocation('http://app.test/start');
  replaceDocument('/a/doc001/edit');
  expect(location.replace).toHaveBeenCalledWith('/a/doc001/edit');
  expect(location.reload).not.toHaveBeenCalled();
});
