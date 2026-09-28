import { expect, it, vi } from 'vitest';
import { takeReloadAnchor } from '@/lib/story-runtime/reader-mode';
import { compiledReaderUpdates } from '../compiled-reader-update';

vi.mock('@/lib/story-runtime/anchor', () => ({
  currentAnchor: () => ({ path: 'section', fraction: 0.4 }),
}));

it('parks the compiled reader anchor before a document reload', () => {
  const reload = vi.fn();
  const win = { name: '', location: { reload } } as unknown as Window;
  compiledReaderUpdates.reload(win);
  expect(reload).toHaveBeenCalledOnce();
  expect(takeReloadAnchor(win)).toEqual({ path: 'section', fraction: 0.4 });
  expect(takeReloadAnchor(win)).toBeNull();
});
