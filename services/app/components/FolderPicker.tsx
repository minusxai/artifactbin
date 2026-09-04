"use client"
/**
 * THE MOVE PICKER — the account's folders as an indented tree built from
 * `ancestor_ids`, root first, the current location marked, a filter input, and
 * the moved folder's own subtree disabled (the cycle rule, DRAWN).
 *
 * It replaced a text field that took a folder id, and the difference is not
 * decoration: an id is not something a person holds, and the ways a move can be
 * refused (`invalid_parent` covers unknown, not-yours, cycle and too deep — one
 * answer, deliberately, because naming them apart is an existence oracle) are
 * all invisible until the server says no. Here the only things offered ARE the
 * account's own folders, and the subtree that would make a cycle is greyed
 * rather than refused after the fact.
 *
 * It decides nothing and sends nothing: choosing calls `onMove(parentId)` and
 * the caller sends `PATCH {parent_id}`. The server re-checks every rule this
 * draws — this is chrome, never an authority.
 *
 * aria-labels are the contract: "Filter folders", "Move to root",
 * "Move to <title>". Plan: ~/projects/artifactbin-folders.md.
 */
import * as React from 'react';

export interface PickerFolder { id: string; title: string | null; ancestor_ids: string[] }
export interface FolderPickerProps {
  /** Every folder the account holds (any order). */
  folders: PickerFolder[];
  /** The row being moved: its own subtree is disabled when it is a folder. */
  moving: { id: string; format: string; ancestor_ids: string[] };
  /** The row's current parent (null = root), marked with aria-current="location". */
  current: string | null;
  onMove: (parentId: string | null) => void;
  onClose: () => void;
}

const nameOf = (folder: PickerFolder): string => folder.title ?? folder.id;

/**
 * Tree order from the flat list — parents before their children, siblings by
 * name. Depth is `ancestor_ids.length`, which is the whole reason placement is
 * an array: no walk, no join, and the indent is a field.
 */
function inTreeOrder(folders: PickerFolder[]): PickerFolder[] {
  const byParent = new Map<string, PickerFolder[]>();
  for (const f of folders) {
    const parent = f.ancestor_ids.length ? f.ancestor_ids[f.ancestor_ids.length - 1] : '';
    byParent.set(parent, [...(byParent.get(parent) ?? []), f]);
  }
  for (const list of byParent.values()) list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const out: PickerFolder[] = [];
  const walk = (parent: string): void => {
    for (const f of byParent.get(parent) ?? []) {
      out.push(f);
      walk(f.id);
    }
  };
  walk('');
  /*
   * A folder whose parent is not in the list would otherwise be dropped
   * silently — a place the person can see everywhere else but not move into.
   * Append whatever the walk did not reach.
   */
  const seen = new Set(out.map((f) => f.id));
  for (const f of folders) if (!seen.has(f.id)) out.push(f);
  return out;
}

const ROW =
  'flex w-full cursor-pointer items-center gap-1.5 rounded-[4px] py-1 pr-2 text-left font-mono text-xs text-muted hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-transparent';

export function FolderPicker({ folders, moving, current, onMove, onClose }: FolderPickerProps): React.ReactElement {
  const [filter, setFilter] = React.useState('');
  const q = filter.trim().toLowerCase();
  const ordered = React.useMemo(() => inTreeOrder(folders), [folders]);
  const shown = q ? ordered.filter((f) => nameOf(f).toLowerCase().includes(q)) : ordered;
  /*
   * THE CYCLE RULE, drawn. A folder may not move into itself nor into anything
   * already under it — `ancestor_ids` containing the moved id IS "under it",
   * with no walk. A document has no subtree, so a move of one disables nothing.
   */
  const forbidden = (folder: PickerFolder): boolean =>
    moving.format === 'folder' && (folder.id === moving.id || folder.ancestor_ids.includes(moving.id));

  return (
    <div
      className="absolute right-0 top-full z-30 mt-1 w-64 rounded-[6px] border border-edge bg-surface p-1.5 shadow-lg"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <input
        aria-label="Filter folders"
        placeholder="filter folders"
        autoFocus
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="mb-1 w-full rounded-[4px] border border-edge bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-fg focus:border-edge-bright focus:outline-none"
      />
      <div className="max-h-64 overflow-y-auto">
        {/* The ROOT is always offered and never filtered away: it is where a row
            goes to leave every folder, and it has no name to type. */}
        <button
          type="button"
          aria-label="Move to root"
          aria-current={current === null ? 'location' : undefined}
          onClick={() => onMove(null)}
          className={`${ROW} pl-2`}
        >
          <span className="truncate">(root)</span>
          {current === null && <span className="ml-auto shrink-0 text-accent">here</span>}
        </button>
        {shown.map((folder) => {
          const depth = folder.ancestor_ids.length;
          const here = current === folder.id;
          return (
            <button
              key={folder.id}
              type="button"
              aria-label={`Move to ${nameOf(folder)}`}
              aria-current={here ? 'location' : undefined}
              data-depth={String(depth)}
              disabled={forbidden(folder)}
              onClick={() => onMove(folder.id)}
              className={ROW}
              style={{ paddingLeft: `${8 + depth * 12}px` }}
            >
              <span className="truncate">{nameOf(folder)}</span>
              {here && <span className="ml-auto shrink-0 text-accent">here</span>}
            </button>
          );
        })}
        {shown.length === 0 && <p className="px-2 py-1 font-mono text-[11px] text-faint">no folder matches</p>}
      </div>
    </div>
  );
}
