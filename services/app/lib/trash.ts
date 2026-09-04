/**
 * THE TRASH (P3 skeleton, seeded by the orchestrator). `deleted_at` on `artifacts` and
 * `annotations`; ONE GATE in the row-loading seam (lib/artifacts getArtifactById + the Scope
 * predicates; lib/annotations' readers) answers a trashed row as nonexistent. Nothing here or
 * elsewhere adds the predicate by hand. Plan: ~/projects/artifactbin-folders.md.
 */
import type { TokenActor } from '@/lib/artifacts';

/** Days a row sits in the trash before the purge hard-deletes it. */
export const TRASH_RETENTION_DAYS = 30;

/** `SET deleted_at = now()` on the row — and, for a folder, over its whole subtree in ONE statement. Owner scope. */
export function trashArtifactFor(actor: TokenActor, id: string): Promise<boolean> { throw new Error('p3: implement'); }

/** `SET deleted_at = NULL`; a row whose parent is still trashed lands at root (ancestor_ids = []). Owner scope. */
export function restoreArtifactFor(actor: TokenActor, id: string): Promise<{ id: string; ancestor_ids: string[] } | null> { throw new Error('p3: implement'); }

/** The owner's trash: id, title, format, deleted_at, newest first. */
export function listTrashFor(actor: TokenActor): Promise<Array<{ id: string; title: string | null; format: string; deleted_at: string }>> { throw new Error('p3: implement'); }

/** Today's hard delete, per row, for everything trashed before `now - olderThanDays`. Returns the ids purged. */
export function purgeTrash(opts: { olderThanDays?: number; now?: Date } = {}): Promise<string[]> { throw new Error('p3: implement'); }
