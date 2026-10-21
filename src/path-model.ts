import type { PathEntry, PathChange } from "./contracts.ts";
const reject = (status: number, message: string): never => {
  throw Object.assign(Error(message), { status });
};
export function normalizePath(value: unknown, root = false): string {
  if (typeof value !== "string")
    return reject(422, "Enter a document or folder path.");
  const path = ("/" + value.replace(/^\//, "")).normalize("NFC");
  if (root && path === "/") return path;
  if (
    path.length > 512 ||
    /[\\%?#\u0000-\u001f\u007f]/.test(path) ||
    path
      .split("/")
      .slice(1)
      .some(
        (s) =>
          !s || s === "." || s === ".." || s.trim() !== s || s.length > 120,
      )
  )
    return reject(
      422,
      "Use folder/name paths without empty parts, dot segments or URL control characters.",
    );
  return path;
}
export function documentUrl(path: string, space?: string): string {
  return (
    "/f" +
    normalizePath(path).split("/").map(encodeURIComponent).join("/") +
    (space === undefined ? "" : "?space=" + encodeURIComponent(space))
  );
}
/** A free name from the title, in `folder` (default the root). */
export function defaultPath(
  title: string,
  entries: PathEntry[],
  folder = "/",
): string {
  const name =
    title
      .normalize("NFC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "untitled";
  const prefix = (folder === "/" ? "" : folder) + "/" + name;
  let path = prefix + ".html",
    n = 2;
  while (entries.some((e) => e.path === path))
    path = prefix + "-" + n++ + ".html";
  return path;
}
function parents(entries: PathEntry[], path: string): PathEntry[] {
  const next = entries.map((e) => ({ ...e })),
    parts = path.split("/").slice(1, -1);
  let prefix = "";
  for (const part of parts) {
    prefix += "/" + part;
    const old = next.find((e) => e.path === prefix);
    if (old?.fileId)
      reject(409, "A document already occupies a parent folder path.");
    if (!old) next.push({ path: prefix, fileId: null });
  }
  return next;
}
export function addDocument(
  entries: PathEntry[],
  path: string,
  fileId: string,
): PathEntry[] {
  path = normalizePath(path);
  if (entries.some((e) => e.path === path))
    reject(409, "That path already exists. Choose another name.");
  return [...parents(entries, path), { path, fileId }];
}
export function changePaths(
  entries: PathEntry[],
  change: PathChange,
): PathEntry[] {
  if (change.kind === "move-many")
    return moveMany(entries, change.paths, change.destination);
  const path = normalizePath(change.path);
  if (change.kind === "folder") {
    if (entries.some((e) => e.path === path))
      reject(409, "That path already exists.");
    return [...parents(entries, path), { path, fileId: null }];
  }
  if (change.kind === "remove-folder") {
    const found = entries.find((e) => e.path === path);
    if (!found) reject(404, "Folder not found.");
    if (found!.fileId || entries.some((e) => e.path.startsWith(path + "/")))
      reject(409, "Only empty folders can be removed.");
    return entries.filter((e) => e.path !== path);
  }
  if (change.kind !== "move") return reject(422, "Unknown folder operation.");
  const from = normalizePath(change.from);
  if (!entries.some((e) => e.path === from)) reject(404, "Path not found.");
  if (from === path) return entries.map((e) => ({ ...e }));
  if (path.startsWith(from + "/"))
    reject(409, "A folder cannot be moved inside itself.");
  const moving = entries.filter(
    (e) => e.path === from || e.path.startsWith(from + "/"),
  );
  const rest = entries.filter((e) => !moving.includes(e));
  if (rest.some((e) => e.path === path))
    reject(409, "That path already exists.");
  let next = parents(rest, path);
  for (const entry of moving) {
    const target = normalizePath(path + entry.path.slice(from.length));
    if (next.some((e) => e.path === target))
      reject(409, "The destination contains an existing path.");
    next.push({ ...entry, path: target });
  }
  return next;
}

function moveMany(
  entries: PathEntry[],
  paths: string[],
  destination: string,
): PathEntry[] {
  if (!Array.isArray(paths) || !paths.length || paths.length > 500)
    return reject(422, "Select between 1 and 500 items to move.");
  destination = normalizePath(destination, true);
  if (
    destination !== "/" &&
    !entries.some((e) => e.path === destination && e.fileId === null)
  )
    return reject(404, "Destination folder not found.");
  const selected = [...new Set(paths.map((p) => normalizePath(p)))];
  for (const path of selected)
    if (!entries.some((e) => e.path === path))
      return reject(
        404,
        "A selected item no longer exists. Refresh and try again.",
      );
  const roots = selected.filter(
    (p) => !selected.some((parent) => p.startsWith(parent + "/")),
  );
  for (const path of roots)
    if (destination === path || destination.startsWith(path + "/"))
      return reject(409, "A folder cannot be moved inside itself.");
  const targets = new Set<string>();
  const next = entries.map((entry) => {
    const root = roots.find(
      (p) => entry.path === p || entry.path.startsWith(p + "/"),
    );
    const path = root
      ? normalizePath(
          (destination === "/" ? "" : destination) +
            "/" +
            root.split("/").at(-1) +
            entry.path.slice(root.length),
        )
      : entry.path;
    if (targets.has(path))
      return reject(
        409,
        "The destination already contains an item with that name. Nothing was moved.",
      );
    targets.add(path);
    return { ...entry, path };
  });
  return next;
}
