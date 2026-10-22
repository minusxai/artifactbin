import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { parse, walk, generate } from "css-tree";
import {
  MAX_FONT_BYTES,
  MAX_FONT_TOTAL_BYTES,
  MAX_FONT_FACES,
} from "./contracts.ts";
import type { ResolvePinnedFonts, PinnedFontFace } from "./contracts.ts";
import { inspectSfnt } from "./inspect.ts";
/** Frozen lock + official package CSS bind typeface names, including variable-font CSS aliases.
 * Only existing pinned files are read. No arbitrary URL or conversion-time network port exists. */
export async function pinnedFontResolver(
  root: string,
): Promise<ResolvePinnedFonts> {
  const manifest = JSON.parse(
      await readFile(
        path.join(root, "services/app/lib/data/story/story-font-manifest.json"),
        "utf8",
      ),
    ),
    lock = JSON.parse(
      await readFile(path.join(root, "package-lock.json"), "utf8"),
    );
  const require = createRequire(path.join(root, "package.json"));
  const { decompress } = require("wawoff2") as {
    decompress: (bytes: Uint8Array) => Promise<Uint8Array>;
  };
  return async (request) => {
    const result: PinnedFontFace[] = [];
    let total = 0;
    for (const family of request.families) {
      if (!Object.hasOwn(manifest.families, family.family))
        throw Error("Requested font family is not pinned");
      const packageName =
        "@fontsource-variable/" +
        family.family.toLowerCase().replaceAll(" ", "-");
      const packageRoot = path.dirname(
        require.resolve(packageName + "/package.json"),
      );
      const pkg = JSON.parse(
          await readFile(path.join(packageRoot, "package.json"), "utf8"),
        ),
        metadata = JSON.parse(
          await readFile(path.join(packageRoot, "metadata.json"), "utf8"),
        );
      if (
        pkg.name !== packageName ||
        lock.packages?.["node_modules/" + packageName]?.version !==
          pkg.version ||
        metadata.family !== family.family
      )
        throw Error("Pinned font package identity mismatch");
      const extraAxes = family.axes
        .filter((axis) => !["ital", "wght"].includes(axis.tag))
        .map((axis) => axis.tag);
      const sheet =
        extraAxes.length === 0
          ? "index"
          : extraAxes.length === 1
            ? extraAxes[0]
            : "standard";
      const css = await readFile(
        path.join(packageRoot, sheet + ".css"),
        "utf8",
      );
      if (Buffer.byteLength(css) > 256_000)
        throw Error("Pinned font CSS limit");
      const ast = parse(css),
        faces: any[] = [];
      ast.children.forEach((node: any) => {
        if (node.type !== "Atrule" || node.name.toLowerCase() !== "font-face")
          throw Error("Unexpected pinned font stylesheet rule");
      });
      walk(ast, (node: any) => {
        if (node.type === "Atrule") {
          if (
            node.name.toLowerCase() !== "font-face" ||
            node.prelude ||
            !node.block
          )
            throw Error("Unexpected pinned font CSS");
          faces.push(node);
        }
      });
      if (faces.length > MAX_FONT_FACES) throw Error("Pinned font face limit");
      const base = await realpath(path.join(packageRoot, "files")),
        expectedStyle =
          family.axes.find((axis) => axis.tag === "ital")?.min === 1
            ? "italic"
            : "normal";
      let matched = 0;
      for (const face of faces) {
        const properties = new Map<string, string>();
        let sourceNodes: any[] = [];
        face.block.children.forEach((node: any) => {
          if (
            node.type !== "Declaration" ||
            node.important ||
            properties.has(node.property) ||
            ![
              "font-family",
              "font-style",
              "font-display",
              "font-weight",
              "font-stretch",
              "src",
              "unicode-range",
            ].includes(node.property)
          )
            throw Error("Unexpected pinned font descriptor");
          properties.set(node.property, generate(node.value));
          if (node.property === "src")
            sourceNodes = node.value.children.toArray();
        });
        const declared = properties.get("font-family");
        if (
          ![
            JSON.stringify(metadata.family),
            JSON.stringify(metadata.family + " Variable"),
            "'" + metadata.family + "'",
            "'" + metadata.family + " Variable'",
          ].includes(declared ?? "")
        )
          throw Error("Pinned font CSS family mismatch");
        const style = properties.get("font-style");
        if (style !== expectedStyle) continue;
        const urls: any[] = [];
        walk(face, (node: any) => {
          if (node.type === "Url") urls.push(node);
        });
        const url = urls[0]?.value;
        if (
          urls.length !== 1 ||
          !/^\.\/files\/[A-Za-z0-9_.-]+\.woff2$/.test(url) ||
          sourceNodes.length !== 2 ||
          sourceNodes[0]?.type !== "Url" ||
          sourceNodes[1]?.type !== "Function" ||
          sourceNodes[1]?.name !== "format" ||
          sourceNodes[1]?.children?.size !== 1 ||
          !["String", "Identifier"].includes(
            sourceNodes[1]?.children?.first?.type,
          ) ||
          !["woff2", "woff2-variations"].includes(
            sourceNodes[1]?.children?.first?.value ??
              sourceNodes[1]?.children?.first?.name,
          )
        )
          throw Error("Pinned font file reference refused");
        const file = await realpath(path.join(packageRoot, url));
        if (!file.startsWith(base + path.sep))
          throw Error("Pinned font file escapes package");
        if ((await stat(file)).size > MAX_FONT_BYTES)
          throw Error("Pinned font file size limit");
        const bytes = await readFile(file);
        if (
          bytes.length < 48 ||
          bytes.length > MAX_FONT_BYTES ||
          bytes.toString("ascii", 0, 4) !== "wOF2" ||
          bytes.readUInt32BE(8) !== bytes.length ||
          bytes.readUInt32BE(16) > 4_000_000
        )
          throw Error("Invalid pinned font container");
        const expanded = await decompress(bytes);
        if (expanded.byteLength !== bytes.readUInt32BE(16))
          throw Error("Pinned font expansion size mismatch");
        const inspected = inspectSfnt(expanded);
        if (
          !inspected.families.some(
            (name) =>
              name === metadata.family ||
              name.startsWith(metadata.family + " "),
          ) ||
          inspected.style !== style
        )
          throw Error("Pinned font binary identity mismatch");
        if (
          family.axes.some((axis) => {
            if (axis.tag === "ital") return false;
            const found = inspected.axes.find(
              (found) => found.tag === axis.tag,
            );
            return found
              ? found.min !== axis.min || found.max !== axis.max
              : axis.tag !== "wght" ||
                  axis.min !== inspected.weight ||
                  axis.max !== inspected.weight;
          })
        )
          continue;
        if (
          inspected.axes.some(
            (axis) =>
              !family.axes.some((requested) => requested.tag === axis.tag),
          )
        )
          continue;
        const weight = inspected.axes.find((axis) => axis.tag === "wght");
        const pair: readonly [number, number] = weight
          ? [weight.min, weight.max]
          : [inspected.weight, inspected.weight];
        if (
          properties.get("font-weight") !==
          (pair[0] === pair[1] ? String(pair[0]) : pair.join(" "))
        )
          throw Error("Pinned font weight proof mismatch");
        const width = inspected.axes.find((axis) => axis.tag === "wdth");
        if (
          width
            ? properties.get("font-stretch") !==
              (width.min === width.max
                ? `${width.min}%`
                : `${width.min}% ${width.max}%`)
            : properties.has("font-stretch")
        )
          throw Error("Pinned font stretch proof mismatch");
        const unicodeRange = properties.get("unicode-range");
        if (!unicodeRange)
          throw Error("Pinned font Unicode coverage unavailable");
        if (
          ++matched > MAX_FONT_FACES ||
          result.length >= MAX_FONT_FACES ||
          (total += bytes.length) > MAX_FONT_TOTAL_BYTES
        )
          throw Error("Pinned font resource limit");
        result.push({
          family: family.family,
          axes: [
            ...inspected.axes,
            ...(!weight
              ? [{ tag: "wght", min: inspected.weight, max: inspected.weight }]
              : []),
          ],
          style: inspected.style,
          weight: pair,
          unicodeRange,
          bytes,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
      if (!matched) throw Error("Requested font axes are not exactly pinned");
    }
    return result;
  };
}
