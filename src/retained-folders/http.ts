import type {
  RetainedFolderReader,
  RetainedFolderRoute,
} from "./http-contracts.ts";
import { retainedFolderHtml } from "./view.ts";
const idPattern = /^[A-Za-z0-9]{6}$/;
/** Folder and ordinary page IDs share canonical artifact addresses. Missing or denied
 * folders fall through to the existing page handler's uniform not-found response. */
export function createRetainedFolderRoute(
  reader: RetainedFolderReader,
): RetainedFolderRoute {
  return async (method, url, credential) => {
    const match = /^\/a\/([A-Za-z0-9]{6})(?:-[^/]*)?$/.exec(url.pathname);
    if (!match || !["GET", "HEAD"].includes(method)) return null;
    if (
      [...url.searchParams.keys()].some((key) => key !== "namespace") ||
      url.searchParams.getAll("namespace").length > 1
    )
      return null;
    const namespace = url.searchParams.get("namespace") ?? undefined;
    if (
      namespace !== undefined &&
      (!namespace ||
        namespace.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(namespace))
    )
      return null;
    const page = await reader.read(match[1]!, credential, namespace);
    if (!page) return null;
    const validRow = (row: { id: string; title: string; url: string }) =>
      idPattern.test(row.id) &&
      typeof row.title === "string" &&
      row.url === "/a/" + row.id;
    if (
      page.id !== match[1] ||
      typeof page.title !== "string" ||
      page.rows.length > 1000 ||
      page.trail.length > 500 ||
      !page.rows.every(
        (row) => validRow(row) && ["folder", "page"].includes(row.kind),
      ) ||
      !page.trail.every(validRow)
    )
      throw Error("Invalid retained folder view");
    const html = retainedFolderHtml(page);
    return {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(Buffer.byteLength(html)),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; frame-ancestors 'none'",
      },
      body: method === "HEAD" ? "" : html,
    };
  };
}
