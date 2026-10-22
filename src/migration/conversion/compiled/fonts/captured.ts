import { createHash } from "node:crypto";
import { pinnedFontResolver } from "./pinned.ts";
import { verifyCapturedFontBundle } from "./verify.ts";
import { createCapturedFontInspector } from "./capture-inspector.ts";
import { parsePinnedFontRequest } from "./inline.ts";
import type { CapturedFontBundleInput } from "./capture-contracts.ts";
import type { ResolvePinnedFonts, InspectedFont } from "./contracts.ts";
/** Explicit bundle entries are replayed exactly; absent entries use pinned local resources only. */
export async function prepareArchivedFontResources(
  root: string,
  input?: CapturedFontBundleInput,
  ports: {
    local?: ResolvePinnedFonts;
    inspect?: (
      bytes: Uint8Array,
      signal: AbortSignal,
    ) => Promise<InspectedFont>;
  } = {},
): Promise<{ resolve: ResolvePinnedFonts; resourceDigest?: string }> {
  const local = ports.local ?? (await pinnedFontResolver(root));
  if (!input) return { resolve: local };
  const bundle = await verifyCapturedFontBundle(input),
    inspect = ports.inspect ?? createCapturedFontInspector(root),
    decoded = new Map<string, Promise<InspectedFont>>();
  return {
    resourceDigest: bundle.resourceDigest,
    resolve: async (request, context) => {
      if (
        !context ||
        createHash("sha256").update(context.requestUrl).digest("hex") !==
          context.requestSha256 ||
        JSON.stringify(parsePinnedFontRequest(context.requestUrl)) !==
          JSON.stringify(request)
      )
        throw Error("Exact font request context required");
      const sheet = bundle.manifest.stylesheets.find(
        (s) =>
          s.requestSha256 === context.requestSha256 &&
          s.requestUrl === context.requestUrl,
      );
      if (!sheet) return local(request, context);
      const faces = [];
      for (const face of sheet.faces) {
        const bytes = bundle.files.get("fonts/" + face.sha256 + ".woff2")!;
        if (!decoded.has(face.sha256))
          decoded.set(
            face.sha256,
            inspect(bytes, new AbortController().signal),
          );
        const actual = await decoded.get(face.sha256)!;
        const family = request.families.find(
          (f) =>
            f.family === face.family &&
            face.style ===
              (f.axes.find((a) => a.tag === "ital")?.min === 1
                ? "italic"
                : "normal") &&
            f.axes.find((a) => a.tag === "wght")?.min === face.weight[0] &&
            f.axes.find((a) => a.tag === "wght")?.max === face.weight[1],
        );
        if (
          !family ||
          !actual.families.some(
            (name) =>
              name === face.family || name.startsWith(face.family + " "),
          ) ||
          actual.style !== face.style ||
          family.axes.some((axis) => {
            if (axis.tag === "ital") return false;
            const found = actual.axes.find((a) => a.tag === axis.tag);
            return found
              ? axis.min < found.min || axis.max > found.max
              : axis.tag !== "wght" ||
                  axis.min !== actual.weight ||
                  axis.max !== actual.weight;
          })
        )
          throw Error("Captured font binary proof mismatch");
        faces.push({
          family: face.family,
          axes: family.axes.filter((a) => a.tag !== "ital"),
          style: face.style,
          weight: face.weight,
          ...(face.stretch ? { stretch: face.stretch } : {}),
          unicodeRange: face.unicodeRange,
          bytes,
          sha256: face.sha256,
        });
      }
      return { faces, omittedRequests: sheet.omittedRequests ?? [] };
    },
  };
}
