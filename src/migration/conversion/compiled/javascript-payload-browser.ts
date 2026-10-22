import type { CompiledJavascriptPayload } from "./javascript-payload-contracts.ts";
import type { decodeCompiledJavascript } from "./javascript-payload-decode.ts";
import type { startCompiledPayload } from "./javascript-payload-lifecycle.ts";
/** Emitted verbatim after the inert payload; no imports, credentials or platform globals. */
export function mountCompiledPayload(
  document: Document,
  target: Window,
  decode: typeof decodeCompiledJavascript,
  start: typeof startCompiledPayload,
): void {
  const status =
    document.querySelector<HTMLElement>("[data-migration-runtime-status]") ??
    document.createElement("p");
  status.setAttribute("data-migration-runtime-status", "");
  status.setAttribute("role", "status");
  status.textContent = "Starting page…";
  document.body.prepend(status);
  const loader = start({
    async decode(signal) {
      const nodes = document.querySelectorAll(
        'script[type="application/json"][data-af-compiled-payload]',
      );
      if (
        nodes.length !== 1 ||
        (nodes[0]!.textContent?.length ?? 0) > 4 * 1024 * 1024
      )
        throw Error("Invalid module envelope");
      return decode(
        JSON.parse(nodes[0]!.textContent ?? "") as CompiledJavascriptPayload,
        signal,
      );
    },
    createURL: (source) =>
      URL.createObjectURL(
        new Blob(
          [
            'if(document.documentElement.hasAttribute("data-af-compiled-retired"))throw Error("Compiled module load cancelled");\n',
            source,
          ],
          { type: "text/javascript" },
        ),
      ),
    revokeURL: (url) => URL.revokeObjectURL(url),
    importModule: (url) => import(url),
    error() {
      status.setAttribute("role", "alert");
      status.textContent =
        "This page could not start. Its saved content is still available below.";
      document.documentElement.setAttribute("data-af-compiled-status", "error");
    },
  });
  const hide = (event: PageTransitionEvent) => {
    // Revocation alone cannot cancel an already fetched native import. This
    // document-local marker gates evaluation before the generated body starts.
    if (!event.persisted)
      document.documentElement.setAttribute("data-af-compiled-retired", "");
    loader.pagehide(event.persisted);
  };
  target.addEventListener("pagehide", hide);
  void loader.settled.finally(() => {
    target.removeEventListener("pagehide", hide);
    if (status.getAttribute("role") !== "alert") status.remove();
  });
}
