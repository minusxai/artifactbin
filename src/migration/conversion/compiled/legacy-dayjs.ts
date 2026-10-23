import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Parser } from "acorn";
import jsx from "acorn-jsx";
import type { LegacyDayjsNormalization } from "./legacy-script-contracts.ts";
export const LEGACY_DAYJS_SHA256 = "9cfdb93f38afcf2d076abecd66d32bfd3383cdf1967654ebc26a26605daf4173";
const libraryUrl = "https://cdnjs.cloudflare.com/ajax/libs/dayjs/1.11.13/dayjs.min.js";
/** One exact archived dependency, not a general network or library resolver. */
export async function inlineLegacyDayjs(source: string): Promise<LegacyDayjsNormalization> {
  if (!source.includes(libraryUrl)) return { source };
  const tree = Parser.extend(jsx()).parseExpressionAt("<>" + source + "</>", 0, { ecmaVersion: "latest" });
  const sites: { start: number; end: number; id?: string }[] = [];
  const visit = (node: any, frame = false): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const item of node) visit(item, frame); return; }
    if (node.type === "JSXElement") {
      const tag = node.openingElement.name.name;
      if (frame && tag === "script") {
        const attrs = node.openingElement.attributes;
        const src = attrs.find((a: any) => a.name?.name === "src");
        if (src?.value?.type === "Literal" && src.value.value === libraryUrl &&
          attrs.every((a: any) => a.type === "JSXAttribute" && ["src", "id"].includes(a.name.name) && a.value?.type === "Literal") &&
          new Set(attrs.map((a: any) => a.name.name)).size === attrs.length && !node.children.length) {
          sites.push({ start: node.start - 2, end: node.end - 2, id: attrs.find((a: any) => a.name.name === "id")?.value.value });
        }
      }
      frame ||= tag === "Iframe";
    }
    for (const value of Object.values(node)) visit(value, frame);
  };
  visit(tree);
  if (!sites.length) return { source };
  const bytes = await readFile(new URL("./vendor/dayjs-1.11.13.js.txt", import.meta.url));
  if (createHash("sha256").update(bytes).digest("hex") !== LEGACY_DAYJS_SHA256)
    throw Error("Pinned classic library integrity mismatch");
  // The original UMD takes its CommonJS branch. Its exact API stays lexical to the frame.
  const script = "const dayjs=(function(){const module={exports:{}};const exports=module.exports;" + bytes.toString("utf8") + ";return module.exports;}).call(undefined);";
  for (const site of sites.sort((a,b)=>b.start-a.start)) {
    const replacement = "<script" + (site.id ? " id={" + JSON.stringify(site.id) + "}" : "") + ">{" + JSON.stringify(script) + "}</script>";
    source = source.slice(0,site.start) + replacement + source.slice(site.end);
  }
  return { source, dayjs: { version: "1.11.13", sourceSha256: LEGACY_DAYJS_SHA256 } };
}
