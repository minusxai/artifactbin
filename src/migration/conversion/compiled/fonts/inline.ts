import { createHash } from "node:crypto";
import { parse, walk } from "css-tree";
import {
  MAX_FONT_BYTES,
  MAX_FONT_TOTAL_BYTES,
  MAX_FONT_FACES,
} from "./contracts.ts";
import type {
  PinnedFontRequest,
  PinnedFontFace,
  ResolvePinnedFonts,
  InlinedFontStylesheet,
  FontAxisRange,
  FontInliningPolicy,
} from "./contracts.ts";
export function parsePinnedFontRequest(raw: string): PinnedFontRequest {
  if (
    Buffer.byteLength(raw) > 8192 ||
    !/^https:\/\/fonts\.googleapis\.com\/css2\?/i.test(raw) ||
    raw.includes("#") ||
    raw.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(raw)
  )
    throw Error("Unsupported font stylesheet address");
  const url = new URL(raw);
  if (
    url.pathname !== "/css2" ||
    url.username ||
    url.password ||
    url.port ||
    [...url.searchParams.keys()].some(
      (key) => !["family", "display"].includes(key),
    ) ||
    url.searchParams.getAll("display").length > 1
  )
    throw Error("Unsupported font stylesheet request");
  const display = url.searchParams.get("display") ?? "auto";
  if (!["auto", "block", "swap", "fallback", "optional"].includes(display))
    throw Error("Unsupported font display");
  const requested = url.searchParams.getAll("family");
  if (!requested.length || requested.length > 8)
    throw Error("Font family limit");
  const families: PinnedFontRequest["families"][number][] = [];
  const seenFamilies = new Set<string>();
  for (const requestedFamily of requested) {
    const parts = requestedFamily.split(":");
    if (
      parts.length > 2 ||
      !/^[A-Za-z][A-Za-z0-9 -]{0,127}$/.test(parts[0]!) ||
      parts[0]!.trim() !== parts[0]
    )
      throw Error("Unsupported font family");
    const family = parts[0]!;
    if (seenFamilies.has(family.toLowerCase()))
      throw Error("Duplicate font family");
    seenFamilies.add(family.toLowerCase());
    if (parts.length === 1) {
      families.push({ family, axes: [{ tag: "wght", min: 400, max: 400 }] });
      continue;
    }
    const spec = parts[1]!.split("@");
    if (spec.length !== 2) throw Error("Unsupported font axes");
    const tags = spec[0]!.split(",");
    if (
      tags.length > 4 ||
      tags.some(
        (tag, index) =>
          !["ital", "opsz", "wdth", "wght"].includes(tag) ||
          (index > 0 && tags[index - 1]! >= tag),
      )
    )
      throw Error("Unsupported font axes");
    const tuples = spec[1]!.split(";");
    if (new Set(tuples).size !== tuples.length)
      throw Error("Duplicate font axis tuple");
    if (tuples.length > 16) throw Error("Font tuple limit");
    for (const tuple of tuples) {
      const values = tuple.split(",");
      if (values.length !== tags.length)
        throw Error("Font axis tuple mismatch");
      const axes: FontAxisRange[] = values.map((raw, index) => {
        if (!/^\d+(?:\.\d+)?(?:\.\.\d+(?:\.\d+)?)?$/.test(raw))
          throw Error("Unsupported font axis range");
        const pair = raw.split("..").map(Number),
          min = pair[0]!,
          max = pair[1] ?? min,
          tag = tags[index]!;
        if (
          min > max ||
          max > 2000 ||
          (tag === "ital" && (min !== max || ![0, 1].includes(min)))
        )
          throw Error("Unsupported font axis bounds");
        return { tag, min, max };
      });
      families.push({ family, axes });
    }
  }
  return { families, display: display as PinnedFontRequest["display"] };
}
export function validFontUnicodeRange(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= 8192 &&
    value.split(",").every((part) => {
      const raw = part.trim(),
        range = /^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/i.exec(raw),
        wildcard = /^U\+([0-9A-F]{0,5})(\?{1,6})$/i.exec(raw);
      let min: number, max: number;
      if (range) {
        min = parseInt(range[1]!, 16);
        max = parseInt(range[2] ?? range[1]!, 16);
      } else if (wildcard && wildcard[1]!.length + wildcard[2]!.length <= 6) {
        min = parseInt(wildcard[1] + wildcard[2]!.replaceAll("?", "0"), 16);
        max = parseInt(wildcard[1] + wildcard[2]!.replaceAll("?", "F"), 16);
      } else return false;
      return min <= max && max <= 0x10ffff;
    })
  );
}
function faceCss(face: PinnedFontFace, request: PinnedFontRequest): string {
  const width = face.axes.find((axis) => axis.tag === "wdth");
  const stretchRange =
    face.stretch ?? (width ? [width.min, width.max] : undefined);
  const stretch = stretchRange
    ? `font-stretch:${stretchRange[0]}%${stretchRange[0] === stretchRange[1] ? "" : ` ${stretchRange[1]}%`};`
    : "";
  return `@font-face{font-family:${JSON.stringify(face.family)};font-style:${face.style};font-weight:${face.weight[0] === face.weight[1] ? face.weight[0] : face.weight.join(" ")};${stretch}font-display:${request.display};src:url("data:font/woff2;base64,${Buffer.from(face.bytes).toString("base64")}") format("woff2");unicode-range:${face.unicodeRange}}`;
}
async function inlinePinnedFontImportsStrict(
  css: string,
  resolve: ResolvePinnedFonts,
): Promise<InlinedFontStylesheet> {
  const ast = parse(css, { positions: true } as any),
    imports: any[] = [];
  walk(ast, (node: any) => {
    if (node.type === "Atrule" && node.name.toLowerCase() === "import")
      imports.push(node);
  });
  if (imports.length > 8) throw Error("Font stylesheet import limit");
  const edits: { start: number; end: number; text: string }[] = [],
    receipts: InlinedFontStylesheet["receipts"][number][] = [];
  let total = 0,
    count = 0;
  for (const node of imports) {
    const children = node.prelude?.children?.toArray() ?? [];
    if (
      node.block ||
      children.length !== 1 ||
      !["Url", "String"].includes(children[0]?.type)
    )
      throw Error("Unsupported font import rule");
    const raw = children[0].value,
      request = parsePinnedFontRequest(raw),
      resolved = await resolve(request, {
        requestUrl: raw,
        requestSha256: createHash("sha256").update(raw).digest("hex"),
      });
    const faces = "faces" in resolved ? resolved.faces : resolved;
    const omitted = "faces" in resolved ? resolved.omittedRequests : [];
    const tupleKey = (value: {
      family: string;
      axes: readonly FontAxisRange[];
    }) => JSON.stringify(value);
    const omissionKeys = new Set(omitted.map(tupleKey));
    if (
      omitted.length > request.families.length ||
      omissionKeys.size !== omitted.length ||
      omitted.some(
        (value) =>
          !request.families.some(
            (requested) => tupleKey(requested) === tupleKey(value),
          ),
      ) ||
      request.families.some(
        (value) => !faces.some((face) => face.family === value.family),
      )
    )
      throw Error("Invalid provider font omissions");
    if (!faces.length) throw Error("Pinned font faces unavailable");
    for (const family of request.families)
      if (
        !omissionKeys.has(tupleKey(family)) &&
        !faces.some(
          (face) =>
            face.family === family.family &&
            face.style ===
              (family.axes.find((axis) => axis.tag === "ital")?.min === 1
                ? "italic"
                : "normal") &&
            family.axes.every((axis) =>
              axis.tag === "ital"
                ? face.style === (axis.min === 1 ? "italic" : "normal")
                : face.axes.some(
                    (found) =>
                      found.tag === axis.tag &&
                      found.min === axis.min &&
                      found.max === axis.max,
                  ),
            ),
        )
      )
        throw Error("Pinned font axis proof mismatch");
    for (const face of faces) {
      if (
        omitted.some(
          (value) =>
            value.family === face.family &&
            face.style ===
              (value.axes.find((axis) => axis.tag === "ital")?.min === 1
                ? "italic"
                : "normal") &&
            value.axes.every(
              (axis) =>
                axis.tag === "ital" ||
                face.axes.some(
                  (found) =>
                    found.tag === axis.tag &&
                    found.min === axis.min &&
                    found.max === axis.max,
                ),
            ),
        )
      )
        throw Error("Provider omission contradicts returned face");
      if (
        (face.stretch !== undefined &&
          (face.stretch.length !== 2 ||
            !face.stretch.every(
              (value) => Number.isFinite(value) && value > 0 && value <= 2000,
            ) ||
            face.stretch[0] > face.stretch[1] ||
            (!(face.stretch[0] === 100 && face.stretch[1] === 100) &&
              !face.axes.some(
                (axis) =>
                  axis.tag === "wdth" &&
                  axis.min === face.stretch![0] &&
                  axis.max === face.stretch![1],
              )))) ||
        !["normal", "italic"].includes(face.style) ||
        face.weight.length !== 2 ||
        !face.weight.every(
          (value) => Number.isFinite(value) && value >= 1 && value <= 1000,
        ) ||
        face.weight[0] > face.weight[1] ||
        !face.axes.some(
          (axis) =>
            axis.tag === "wght" &&
            axis.min === face.weight[0] &&
            axis.max === face.weight[1],
        ) ||
        ++count > MAX_FONT_FACES ||
        face.bytes.byteLength > MAX_FONT_BYTES ||
        (total += face.bytes.byteLength) > MAX_FONT_TOTAL_BYTES ||
        Buffer.from(face.bytes).subarray(0, 4).toString() !== "wOF2" ||
        createHash("sha256").update(face.bytes).digest("hex") !== face.sha256 ||
        !validFontUnicodeRange(face.unicodeRange)
      )
        throw Error("Invalid pinned font bytes or descriptors");
      if (
        !request.families.some(
          (family) =>
            family.family === face.family &&
            !face.axes.some(
              (axis) =>
                !family.axes.some((requested) => requested.tag === axis.tag),
            ) &&
            face.style ===
              (family.axes.find((axis) => axis.tag === "ital")?.min === 1
                ? "italic"
                : "normal") &&
            family.axes.every((axis) =>
              axis.tag === "ital"
                ? face.style === (axis.min === 1 ? "italic" : "normal")
                : face.axes.some(
                    (found) =>
                      found.tag === axis.tag &&
                      found.min === axis.min &&
                      found.max === axis.max,
                  ),
            ),
        )
      )
        throw Error("Unrequested pinned font face");
    }
    edits.push({
      start: node.loc.start.offset,
      end: node.loc.end.offset,
      text: faces.map((face) => faceCss(face, request)).join("\n"),
    });
    receipts.push({
      requestSha256: createHash("sha256").update(raw).digest("hex"),
      ...(omitted.length ? { omittedRequests: omitted } : {}),
      faces: faces.map((face) => ({
        sha256: face.sha256,
        bytes: face.bytes.byteLength,
      })),
    });
  }
  for (const edit of edits.reverse())
    css = css.slice(0, edit.start) + edit.text + css.slice(edit.end);
  return { css, receipts };
}

/** Resource-manifest verification belongs to the caller and runs before this
 * presentation-only fallback. No local proof is claimed for retained imports. */
export async function inlinePinnedFontImports(css:string,resolve:ResolvePinnedFonts,policy:FontInliningPolicy="strict"):Promise<InlinedFontStylesheet>{
 try{return await inlinePinnedFontImportsStrict(css,resolve);}
 catch(error){if(policy!=="preserve-unresolved")throw error;return {css,receipts:[]};}
}
