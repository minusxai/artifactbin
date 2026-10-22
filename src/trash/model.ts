import type { TrashItem } from './contracts.ts';
import { fail } from '../errors.ts';
/** Restoration is all-or-nothing; never overwrite a newly created path. */
export function restorePaths(items: readonly TrashItem[], root: TrashItem, active: readonly string[]): TrashItem[] {
  const parent = root.path.includes('/') ? root.path.slice(0, root.path.lastIndexOf('/')) : '';
  const target = parent && !active.includes(parent) ? (root.path.startsWith('/') ? '/' : '') + root.path.slice(root.path.lastIndexOf('/') + 1) : root.path;
  const restored = items.map(item => ({ ...item, path: target + item.path.slice(root.path.length) }));
  if (restored.some(item => active.includes(item.path))) fail(409, 'A live item already uses the restore path');
  return restored;
}
