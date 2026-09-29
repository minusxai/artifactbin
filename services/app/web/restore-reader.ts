import { applyAnchor } from '@/lib/story-runtime/anchor';
import { holdAnchor } from '@/lib/story-runtime/anchor-restore';
import { takeReloadAnchor } from '@/lib/story-runtime/reader-mode';

/** Restore a compiled /a reader before the optional React app boots. */
export function restoreReloadedReader(win: Window = window): void {
  const kept = takeReloadAnchor(win);
  if (kept) holdAnchor(win, kept, applyAnchor);
}
