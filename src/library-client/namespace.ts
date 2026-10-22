import type { NamespaceNavigation } from "./contracts.ts";
import type { LibraryNamespace } from "../group-authority-contracts.ts";
/** Scope only owner-aware library operations; account identity always remains personal. */
export function namespaceLibraryPath(path: string, owner?: string): string {
  if (!owner) return path;
  const url = new URL(path, "https://local.invalid");
  if (
    ["/api/library", "/api/library/paths", "/api/library/example"].includes(
      url.pathname,
    ) ||
    url.pathname.startsWith("/api/trash")
  )
    url.searchParams.set("owner", owner);
  return url.pathname + url.search;
}
export function namespaceNavigation(
  namespace: LibraryNamespace | undefined,
  folder = "/",
): NamespaceNavigation {
  const query = new URLSearchParams();
  if (namespace?.kind === "group") query.set("owner", namespace.owner);
  if (folder !== "/") query.set("folder", folder);
  return {
    manage:
      !namespace ||
      namespace.kind === "personal" ||
      namespace.role === "editor",
    create: !namespace || namespace.kind === "personal",
    url: "/" + (query.size ? "?" + query : ""),
  };
}
