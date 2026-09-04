/**
 * FOLDERS — the one module that knows the hierarchy (P1 skeleton, seeded by the orchestrator).
 *
 * A folder is an artifact with `format: 'folder'`. Placement is `artifacts.ancestor_ids`,
 * the ids of the ancestors root→parent: `[]` is the root, the last element is the parent,
 * the length is the level. Nothing outside this module does array arithmetic on it.
 * Plan: ~/projects/artifactbin-folders.md. Every body here throws until P1 implements it.
 */
import type { ArtifactRow, TokenActor } from '@/lib/artifacts';
import type { DatasetColumn } from '@/lib/story/dataset-usage';

/** No resulting row may sit deeper than this (level = ancestor_ids.length). */
export const MAX_FOLDER_DEPTH = 6;

/** The fixed shape of a folder's children table, registered as `ref_<folderId>` in a <Query>. */
export const CHILDREN_COLUMNS: DatasetColumn[] = [
  { name: 'id', type: 'string' }, { name: 'title', type: 'string' }, { name: 'format', type: 'string' },
  { name: 'level', type: 'number' }, { name: 'visibility', type: 'string' }, { name: 'updated_at', type: 'string' },
  { name: 'url', type: 'string' }, { name: 'thumbnail', type: 'string' }, { name: 'views', type: 'number' }, { name: 'sparkline', type: 'string' },
];

/** One refusal for unknown, not-a-folder, not-yours, cycle and too deep — naming them apart is an existence oracle. */
export type ParentRefusal = { error: 'invalid_parent' };

/** The stored source a new folder is stamped with, its own id filled in. EXACT text per the brief. */
export function folderScaffold(id: string): string { throw new Error('p1: implement'); }

/** The parent of a row (last of ancestor_ids) or null at root. */
export function parentOf(row: Pick<ArtifactRow, 'ancestor_ids'>): string | null { throw new Error('p1: implement'); }

/**
 * Resolve a wire `parent_id` for a row about to be created or moved, AFTER the ownership scope
 * has resolved the row: the parent must be a folder the same owner holds, must not be `moved`
 * or inside it, and the deepest resulting row (parent level + 1 + the moved subtree's height)
 * must not exceed MAX_FOLDER_DEPTH. Answers the new `ancestor_ids` for the row.
 */
export function resolveParent(
  owner: { userId: string | null; tokenId: string },
  parentId: string | null,
  moved: { id: string; format: string } | null,
): Promise<{ ancestor_ids: string[] } | ParentRefusal> { throw new Error('p1: implement'); }

/**
 * The children VIRTUAL TABLE for a folder, computed for ONE viewer on the server, never filtered
 * on the client: rows the viewer may read; `thumbnail` only for public/unlisted rows;
 * `views`/`sparkline` only when the viewer is the folder's owner or an editor, else null.
 */
export function childrenTableFor(
  folder: ArtifactRow,
  viewer: { userId: string | null; email: string | null; tokenId: string | null } | null,
): Promise<{ rows: Record<string, unknown>[]; columns: DatasetColumn[] }> { throw new Error('p1: implement'); }

/** True when no live row names `id` as its parent. */
export function folderIsEmpty(id: string): Promise<boolean> { throw new Error('p1: implement'); }

/** Every id under a folder (GIN containment), for a forced delete. */
export function subtreeIds(id: string): Promise<string[]> { throw new Error('p1: implement'); }

/** The one place that names the channel a child write wakes: the parent folder's own. */
export function notifyParent(parentId: string | null): Promise<void> { throw new Error('p1: implement'); }

/** Unused-parameter guards for the skeleton; deleted by the implementation. */
void (null as unknown as TokenActor);
