/** Trash retains IDs, versions and storage indefinitely. */
export interface TrashEntry {
  id: string;
  path: string;
  deletedAt: number;
  kind: "page" | "folder";
}
export interface RestoreResult {
  id: string;
  path: string;
  restoredIds: string[];
}
export interface TrashItem {
  id: string;
  path: string;
  kind: "page" | "folder";
}
