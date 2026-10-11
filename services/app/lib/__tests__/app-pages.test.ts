/** The app's own static pages: the dev-only component gallery is a page in development and a 404 in production. */
import { expect, it } from 'vitest';
import { DEV_SPA_PATHS, SPA_PATHS, spaPaths } from '@/lib/http/app-pages';

it('answers /dev/ui only in development', () => {
  expect(SPA_PATHS.test('/dev/ui')).toBe(false);
  expect(DEV_SPA_PATHS.test('/dev/ui')).toBe(true);
  expect(spaPaths({ dev: false })).toBe(SPA_PATHS);
  expect(spaPaths({ dev: true })).toBe(DEV_SPA_PATHS);
  for (const path of ['/', '/trash', '/programs/x/edit', '/datasets/new']) expect(DEV_SPA_PATHS.test(path)).toBe(true);
  for (const path of ['/dev', '/dev/ui/x', '/dev/uix']) expect(DEV_SPA_PATHS.test(path)).toBe(false);
});
