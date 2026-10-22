import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { CompiledJavascriptPayload } from "./javascript-payload-contracts.ts";
import { decodeCompiledJavascript } from "./javascript-payload-decode.ts";
import { startCompiledPayload } from "./javascript-payload-lifecycle.ts";
import { mountCompiledPayload } from "./javascript-payload-browser.ts";
/** Called only after decoded compiler output passes the existing admission policy. */
export function compiledJavascriptMarkup(
  javascript: string,
  packed = false,
): string {
  if (!packed)
    return `<script type="module">${javascript.replace(/<\/script/gi, "<\\/script")}</script>`;
  const bytes = Buffer.from(javascript);
  if (!bytes.length || bytes.length > 32 * 1024 * 1024)
    throw Error("Compiled module exceeds decoded limit");
  const gzip = gzipSync(bytes, { level: 9 });
  if (gzip.length > 3 * 1024 * 1024)
    throw Error("Compiled module exceeds packed limit");
  const payload: CompiledJavascriptPayload = {
    compression: "gzip",
    base64: gzip.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    uncompressedBytes: bytes.length,
  };
  const loader = `(()=>{const __name=f=>f;(${mountCompiledPayload.toString()})(document,window,${decodeCompiledJavascript.toString()},${startCompiledPayload.toString()});})();`;
  return `<p data-migration-runtime-status role="status" style="position:fixed;top:0;left:0;right:0;margin:0;padding:8px;background:Canvas;color:CanvasText;z-index:2147483647">This page has not started. Its saved content is available below.</p><script type="application/json" data-af-compiled-payload>${JSON.stringify(payload)}</script><script type="module">${loader}</script>`;
}
