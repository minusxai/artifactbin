import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type {
  LegacyRawMediaAddress,
  LegacyRawMediaRewrite,
} from "./media-contracts.ts";
import { canonicalMediaUrl } from "./conversion/compiled/media.ts";
import { readLocalSourceLiteral } from "./conversion/compiled/source-manifest.ts";
/** Grammar only. A parsed legacy URL confers no byte or page authority. */
export function parseLegacyRawMediaAddress(
  value: string,
): LegacyRawMediaAddress | null {
  if (
    value.startsWith("//") ||
    value.includes("#") ||
    (!value.startsWith("/") && !/^https?:\/\//.test(value))
  )
    return null;
  try {
    const url = new URL(value, "https://relative.invalid");
    if (url.username || url.password) return null;
    const found = /^\/a\/([A-Za-z0-9]{6,128})\/raw$/.exec(url.pathname);
    if (
      !found ||
      [...url.searchParams.keys()].some((key) => !["v", "w"].includes(key))
    )
      return null;
    const result: { artifactId: string; version?: number; width?: number } = {
      artifactId: found[1]!,
    };
    for (const [key, name] of [
      ["v", "version"],
      ["w", "width"],
    ] as const) {
      const values = url.searchParams.getAll(key);
      if (values.length > 1) return null;
      if (values.length) {
        const raw = values[0]!;
        if (!/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(Number(raw)))
          return null;
        result[name] = Number(raw);
      }
    }
    return result;
  } catch {
    return null;
  }
}
function mappedUrl(
  value: string,
  map: Readonly<Record<string, string>>,
): string | undefined {
  const parsed = parseLegacyRawMediaAddress(value);
  if (!parsed) return;
  const base = value.startsWith("/") ? "" : new URL(value).origin;
  const query = [
    ...(parsed.version === undefined ? [] : [`v=${parsed.version}`]),
    ...(parsed.width === undefined ? [] : [`w=${parsed.width}`]),
  ].join("&");
  const key = `${base}/a/${parsed.artifactId}/raw${query ? "?" + query : ""}`;
  return Object.hasOwn(map, key) ? map[key] : undefined;
}
/** Rewrite static authored literals before compilation, so SSR and reactive hydration agree.
 * Only importer-verified canonical media mappings are eligible; arbitrary strings/expressions remain intact.
 */
function rewriteRawSource(
  source: string,
  map: Readonly<Record<string, string>>,
  selected?: Record<string, string>,
): LegacyRawMediaRewrite {
  if (Object.values(map).some((value) => !canonicalMediaUrl(value)))
    throw Error("Invalid verified media mapping");
  if (!Object.keys(map).length) return { source, rewritten: 0 };
  let tree: any;
  try {
    tree = Parser.extend(jsx()).parse("<>" + source + "</>", {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch {
    return { source, rewritten: 0 };
  }
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXElement") {
      const tag = node.openingElement.name.name;
      for (const attr of node.openingElement.attributes) {
        if (
          attr.type !== "JSXAttribute" ||
          !(
            (tag === "a" && attr.name.name === "href") ||
            (["img", "File"].includes(tag) && attr.name.name === "src")
          )
        )
          continue;
        let value: unknown;
        try {
          value = readLocalSourceLiteral(attr.value);
        } catch {
          continue;
        }
        if (typeof value !== "string") continue;
        const target = mappedUrl(value, map);
        if (target && selected) {
          for (const [key, mapped] of Object.entries(map))
            if (mapped === target && mappedUrl(value, { [key]: mapped }))
              selected[key] = mapped;
        }
        if (target)
          edits.push({
            start: attr.value.start - 2,
            end: attr.value.end - 2,
            text: JSON.stringify(target),
          });
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(tree);
  let rewritten = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    rewritten =
      rewritten.slice(0, edit.start) + edit.text + rewritten.slice(edit.end);
  return { source: rewritten, rewritten: edits.length };
}

export function rewriteLegacyRawMediaSource(
  source: string,
  map: Readonly<Record<string, string>>,
): LegacyRawMediaRewrite {
  return rewriteRawSource(source, map);
}
/** Include new aliases only for static literal references in this exact source revision. */
export function referencedLegacyRawMediaMappings(
  source: string,
  map: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const selected: Record<string, string> = {};
  rewriteRawSource(source, map, selected);
  return selected;
}
