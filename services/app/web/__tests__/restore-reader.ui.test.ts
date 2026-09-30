import { expect, it, vi } from 'vitest';
import { writeReloadAnchor } from '@/lib/story-runtime/reader-mode';
import { holdAnchor } from '@/lib/story-runtime/anchor-restore';
import { restoreReloadedReader } from '../restore-reader';

vi.mock('@/lib/story-runtime/anchor-restore', () => ({ holdAnchor: vi.fn() }));

it('restores the compiled /a reader position before the optional app boots', async () => {
  const win = { name: '' } as Window;
  const anchor = { path: 'section', fraction: 0.4 };
  writeReloadAnchor(win, anchor);
  await restoreReloadedReader(win);
  expect(holdAnchor).toHaveBeenCalledWith(win, anchor, expect.any(Function));
  await restoreReloadedReader(win);
  expect(holdAnchor).toHaveBeenCalledOnce();
});
