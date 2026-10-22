import { childPath, canMoveTo, movePaths } from "../file-browser.js";
import { MAX_PAGE_SOURCE, utf8ByteLength } from "../af-contracts.ts";
import type { LibraryActions, LibraryActionsOptions } from "./contracts.ts";
const TOO_LARGE = `Choose an HTML file of at most ${MAX_PAGE_SOURCE.toLocaleString("en-US")} UTF-8 bytes (${MAX_PAGE_SOURCE / 1e6} MB).`;
const EMPTY = "This file is empty. Choose an HTML file with a page in it.";
/** Library command policy: validated paths, bounded uploads, stable creation retries. */
export function createLibraryActions(
  options: LibraryActionsOptions,
): LibraryActions {
  let example: { requestId: string; folder?: string } | undefined;
  const change = async (body: unknown) => {
    await options.request("/api/library/paths", body);
  };
  const parent = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
  return {
    rename: async (from, name) =>
      change({ kind: "move", from, path: childPath(parent(from), name) }),
    createFolder: async (name) =>
      change({ kind: "folder", path: childPath(options.folder, name) }),
    async move(paths, destination) {
      if (!canMoveTo(paths, destination))
        throw Error("Choose a valid destination.");
      await change({ kind: "move-many", paths: movePaths(paths), destination });
    },
    removeFolder: (path) => change({ kind: "remove-folder", path }),
    async createExample() {
      example ??= {
        requestId: options.id(),
        ...(options.folder === "/" ? {} : { folder: options.folder }),
      };
      return (
        await options.request<{ url: string }>("/api/library/example", example)
      ).url;
    },
    async publish(file) {
      if (!/\.html?$/i.test(file.name))
        throw Error("Choose an HTML file (.html or .htm).");
      if (!file.size) throw Error(EMPTY);
      if (file.size > MAX_PAGE_SOURCE) throw Error(TOO_LARGE);
      const path = childPath(options.folder, file.name);
      const html = await file.text();
      if (!html.trim()) throw Error(EMPTY);
      if (utf8ByteLength(html) > MAX_PAGE_SOURCE) throw Error(TOO_LARGE);
      return (
        await options.request<{ url: string }>("/api/library", {
          html,
          path,
          requestId: options.id(),
        })
      ).url;
    },
  };
}
