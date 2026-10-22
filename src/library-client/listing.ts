import type {
  LibraryListing,
  LibrarySearchEntry,
  LibrarySurface,
} from "./contracts.ts";
const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
/** The rows a folder shows: its folders (sorted), then its documents, matching the search. */
export function libraryListing({
  folder,
  files,
  folders,
  query,
  visibilities = [],
}: {
  folder: string;
  files: readonly LibrarySearchEntry[];
  folders: readonly string[];
  query: string;
  visibilities?: readonly string[];
}): LibraryListing {
  if (folder !== "/" && !folders.includes(folder))
    return { state: "missing", visible: [] };
  const entries = [
    ...folders
      .filter((p) => parent(p) === folder)
      .sort()
      .map((path) => ({ path, title: "" })),
    ...files.filter((f) => parent(f.path) === folder),
  ];
  const visible = filterLibraryEntries(entries, query, visibilities).map(
    (e) => e.path,
  );
  return {
    state: !entries.length ? "empty" : visible.length ? "rows" : "no-results",
    visible,
  };
}

/** A single search policy applies to the shelf and artifacts shared with its viewer. */
export function filterLibraryEntries<T extends LibrarySearchEntry>(
  entries: readonly T[],
  query: string,
  visibilities: readonly string[] = [],
): T[] {
  const q = query.toLowerCase();
  return entries.filter(
    (entry) =>
      (entry.path + " " + (entry.title || "")).toLowerCase().includes(q) &&
      (!visibilities.length ||
        !entry.visibility ||
        visibilities.includes(entry.visibility)),
  );
}
/** Shared artifacts are part of the library, including when the viewer owns none. */
export function librarySurface(
  ownState: LibraryListing["state"],
  sharedCount: number,
  visibleSharedCount: number,
): LibrarySurface {
  return {
    onboarding: ownState === "empty" && !sharedCount,
    toolbar:
      ownState === "rows" || ownState === "no-results" || sharedCount > 0,
    noResults:
      (ownState === "empty" || ownState === "no-results") &&
      !visibleSharedCount &&
      (ownState === "no-results" || sharedCount > 0),
  };
}

/** Downloads remain HTML after a library rename removes the extension. */
export function htmlDownloadName(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return /\.html?$/i.test(name) ? name : name + ".html";
}
/** Folder covers summarize all documents beneath the folder, with three preview papers. */
export function folderContents<T extends { path: string }>(
  path: string,
  files: readonly T[],
): { count: number; previews: T[] } {
  const descendants = files.filter((file) => file.path.startsWith(path + "/"));
  return { count: descendants.length, previews: descendants.slice(0, 3) };
}
