import type { LibraryListing } from "./contracts.ts";
const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
/** The rows a folder shows: its folders (sorted), then its documents, matching the search. */
export function libraryListing({
  folder,
  files,
  folders,
  query,
}: {
  folder: string;
  files: readonly { path: string; title?: string }[];
  folders: readonly string[];
  query: string;
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
  const q = query.toLowerCase();
  const visible = entries
    .filter((e) => (e.path + " " + (e.title || "")).toLowerCase().includes(q))
    .map((e) => e.path);
  return {
    state: !entries.length ? "empty" : visible.length ? "rows" : "no-results",
    visible,
  };
}
