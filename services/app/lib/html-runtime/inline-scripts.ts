import { parse, type DefaultTreeAdapterMap } from "parse5";
import { sha256Hex } from "@artifactbin/utils/sha256";
import type { InlineScriptAdmission } from "./inline-script-contract";
export const INLINE_SCRIPT_POLICY = "script-policy";
const scriptTypes = new Set([
  "",
  "module",
  "importmap",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);
function executableType(node: DefaultTreeAdapterMap["element"]): boolean {
  const type = node.attrs.find((attr) => attr.name === "type"),
    language = node.attrs.find((attr) => attr.name === "language");
  const kind = (
    type ? type.value : language?.value ? "text/" + language.value : ""
  )
    .trim()
    .toLowerCase();
  const essence = kind.split(";")[0]!.trim();
  return (
    scriptTypes.has(kind) ||
    (kind.includes(";") &&
      !["", "module", "importmap"].includes(essence) &&
      scriptTypes.has(essence))
  );
}
const hash = (source: string) =>
  `'sha256-${btoa(
    sha256Hex(source)
      .match(/../g)!
      .map((byte) => String.fromCharCode(parseInt(byte, 16)))
      .join(""),
  )}'`;
/** Browser parsing normalizes newlines/entities before CSP hashes inline code.
 * Inert template contents and data blocks cannot grant executable admission.
 * URL sources remain constrained by the existing hosted response policy. The
 * supplementary policy does not grant network access; data modules are retained
 * for packaged portable files, while the hosted header still refuses them.
 */
export function admitInitialInlineScripts(
  html: string,
  platformNonce?: string,
): InlineScriptAdmission {
  if (
    platformNonce !== undefined &&
    !/^[A-Za-z0-9+\/_-]{16,128}={0,2}$/.test(platformNonce)
  )
    throw Error("Invalid platform script nonce");
  const scripts = new Set<string>(),
    handlers = new Set<string>();
  const walk = (node: DefaultTreeAdapterMap["node"]) => {
    if ("attrs" in node) {
      for (const attr of node.attrs)
        if (/^on[a-z]+$/.test(attr.name)) handlers.add(hash(attr.value));
      if (
        node.nodeName === "script" &&
        !node.attrs.some((attr) => attr.name === "src") &&
        executableType(node)
      ) {
        const source = node.childNodes
          .filter((child) => child.nodeName === "#text")
          .map((child) => (child as DefaultTreeAdapterMap["textNode"]).value)
          .join("");
        scripts.add(hash(source));
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) walk(child);
  };
  walk(parse(html));
  const scriptHashes = [...scripts],
    handlerHashes = [...handlers];
  return {
    scriptHashes,
    handlerHashes,
    policy: `script-src 'self' * blob: data: 'wasm-unsafe-eval' ${platformNonce ? "'nonce-" + platformNonce + "' " : ""}${scriptHashes.join(" ")}; script-src-attr ${handlerHashes.length ? "'unsafe-hashes' " + handlerHashes.join(" ") : "'none'"}`,
  };
}
