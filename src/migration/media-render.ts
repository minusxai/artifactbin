import type { MigratedAsset } from "./media-contracts.ts";
import type { ConversionOutput } from "./contracts.ts";
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export function migrationAssetUrl(
  asset: MigratedAsset,
  pageId: string,
  origin: string,
): string {
  const base = new URL(origin);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    !/^[A-Za-z0-9]{6}$/.test(pageId) ||
    !Number.isSafeInteger(asset.version) ||
    asset.version < 1 ||
    !["original", "small"].includes(asset.variant) ||
    !/^[a-f0-9]{64}$/.test(asset.sha256)
  )
    throw new Error("Invalid media URL");
  return new URL(
    "/af/v1/ids/" +
      encodeURIComponent(pageId) +
      "/assets/" +
      asset.version +
      "/" +
      asset.variant +
      "/" +
      asset.sha256,
    origin,
  ).href;
}
export function convertMigrationMedia(input: {
  format: string;
  version: number;
  pageId: string;
  title?: string;
  coreUrl: string;
  origin: string;
  assets: readonly MigratedAsset[];
}): ConversionOutput {
  const assets = input.assets.filter((a) => a.version === input.version);
  const original = assets.find((a) => a.variant === "original");
  if (!original)
    return {
      classification: "manual-blocked",
      html: null,
      issues: ["Missing verified original media bytes for saved revision"],
      identities: {},
    };
  const url = esc(migrationAssetUrl(original, input.pageId, input.origin));
  const title = esc(input.title ?? "Imported media");
  const content =
    input.format === "image"
      ? `<img data-af-id="media" src="${url}" alt="${title}">`
      : `<a data-af-id="media" href="${url}" download>${title}</a>`;
  return {
    classification: "renderable",
    html: `<!doctype html><html><head><script data-af="core" src="${esc(input.coreUrl)}"></script><meta charset="utf-8"><title>${title}</title></head><body><main>${content}</main></body></html>`,
    issues: [],
    identities: { media: "media" },
    strategy: "media-wrapper",
  };
}

/** Only documented exact legacy byte URLs are mapped; HTML links and ref: expressions are not guessed. */
export function migrationResourceMap(
  assets: readonly MigratedAsset[],
  pages: Record<string, string>,
  origin: string,
  legacyOrigins: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const asset of assets) {
    const pageId = pages[asset.artifactId];
    if (!pageId) continue;
    if (asset.variant === "small" && !asset.width) continue;
    const old =
      "/a/" +
      encodeURIComponent(asset.artifactId) +
      "/raw?v=" +
      asset.version +
      (asset.variant === "small" ? "&w=" + asset.width : "");
    const target = migrationAssetUrl(asset, pageId, origin);
    for (const url of [
      old,
      ...legacyOrigins.map((base) => new URL(old, base).href),
    ]) {
      if (result[url] && result[url] !== target)
        throw new Error("Ambiguous legacy media URL");
      result[url] = target;
    }
  }
  return result;
}
