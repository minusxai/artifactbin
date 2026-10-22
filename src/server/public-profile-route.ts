import type {
  PublicProfileRepository,
  PublicProfileResponse,
} from "./public-profile-contracts.ts";
import { normalizeHandle, handleProblem } from "./handles.ts";
import { publicProfileHtml } from "./public-profile-view.ts";
const fileId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9]{6}$/.test(value);
const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; frame-ancestors 'none'",
};
export function createPublicProfileRoute(repository: PublicProfileRepository) {
  return async (
    method: string,
    url: URL,
  ): Promise<PublicProfileResponse | null> => {
    const matched = /^\/@([^/]+)$/.exec(url.pathname);
    if (!matched) return null;
    const error = (status: number, text: string): PublicProfileResponse => ({
      status,
      headers,
      body:
        method === "HEAD"
          ? ""
          : `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${text}</title></head><body><h1>${text}</h1></body></html>`,
    });
    if (!["GET", "HEAD"].includes(method))
      return error(404, "Profile not found");
    let handle: string;
    try {
      handle = normalizeHandle(decodeURIComponent(matched[1]!));
    } catch {
      return error(404, "Profile not found");
    }
    if (handleProblem(handle)) return error(404, "Profile not found");
    if (
      [...url.searchParams.keys()].some(
        (key) => !["after", "limit"].includes(key),
      ) ||
      ["after", "limit"].some((key) => url.searchParams.getAll(key).length > 1)
    )
      return error(400, "Invalid profile page");
    const after = url.searchParams.get("after"),
      rawLimit = url.searchParams.get("limit"),
      limit =
        rawLimit === null
          ? 24
          : /^\d+$/.test(rawLimit)
            ? Number(rawLimit)
            : NaN;
    if (
      (after !== null && !fileId(after)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      return error(400, "Invalid profile page");
    const page = await repository.read(handle, after, limit);
    if (!page) return error(404, "Profile not found");
    if (
      page.handle !== handle ||
      !Array.isArray(page.files) ||
      page.files.length > limit ||
      new Set(page.files.map((f) => f.id)).size !== page.files.length ||
      page.files.some(
        (f) =>
          !fileId(f.id) || typeof f.title !== "string" || f.title.length > 8192,
      ) ||
      !(
        page.next === null ||
        (fileId(page.next) && page.next === page.files.at(-1)?.id)
      )
    )
      throw Error("Invalid public profile result");
    return {
      status: 200,
      headers,
      body: method === "HEAD" ? "" : publicProfileHtml(page, limit),
    };
  };
}
