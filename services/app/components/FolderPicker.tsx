"use client"
/**
 * THE MOVE PICKER (P2 skeleton, seeded by the orchestrator) — the account's folders as an
 * indented tree built from `ancestor_ids`, root first, the current location marked, a filter
 * input, and the moved folder's own subtree disabled (the cycle rule, drawn). Choosing one
 * calls `onMove(parentId)`; the caller sends `PATCH {parent_id}`. Plan: ~/projects/artifactbin-folders.md.
 * aria-labels are the contract: "Filter folders", "Move to root", "Move to <title>".
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
export function FolderPicker(_props: FolderPickerProps): React.ReactElement { throw new Error('p2: implement'); }
