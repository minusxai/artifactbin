import { parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import type { MigrationMaps } from "./contracts.ts";

export interface MigrationLinkDiagnostic {
  legacyId: string;
  pageId: string;
  disposition: "legacy-target-blocked" | "legacy-origin-required" | "legacy-target-unmapped";
}
export interface MigrationLinkOptions {
  legacyOrigins: readonly string[];
  targetOrigin: string;
  readyPages?: ReadonlySet<string>;
  onDiagnostic?: (diagnostic: MigrationLinkDiagnostic) => void;
}
/** Only structural links at exact allowlisted origins are migration references. */
export function rewriteMigrationLinks(
  html: string,
  maps: MigrationMaps,
  options: MigrationLinkOptions,
): string {
  const origins = options.legacyOrigins.map((origin) => new URL(origin).origin);
  const document = parse(html, { sourceCodeLocationInfo: true });
  const edits: { start: number; end: number; text: string }[] = [];
  const walk = (node: DefaultTreeAdapterTypes.Node) => {
    if ("attrs" in node) {
      const attr = node.attrs.find((a) => a.name === "href");
      const location = node.sourceCodeLocation?.attrs?.href;
      if (attr && location) {
        const value = attr.value;
        const absolute = /^(?:https?:)?\/\//i.test(value);
        let url: URL | null = null;
        try {
          url = new URL(value, "https://relative.invalid");
        } catch {}
        const allowed =
          url &&
          !url.username &&
          !url.password &&
          ((!absolute && url.origin === "https://relative.invalid") ||
            origins.includes(url.origin));
        const match = url?.pathname.match(
          /^\/(?:a\/|@[a-zA-Z0-9-]+\/)([a-zA-Z0-9]+)(?:-[a-zA-Z0-9][a-zA-Z0-9-]*)?\/?$/,
        );
        const reference = value.match(/^ref:([a-zA-Z0-9]+)$/);
        const oldId = reference?.[1] ?? match?.[1];
        const id = oldId ? maps.pages[oldId] : undefined;
        const context = node.nodeName === "link" && node.attrs.some(a => a.name === "rel" && a.value === "related") && node.attrs.some(a => a.name === "data-migration-context" && a.value === "supporting-document");
        if (context && value.startsWith("ref:")) {
          if (!reference || !/^[A-Za-z0-9]{6,12}$/.test(reference[1]!)) throw Error("Invalid supporting document reference");
          if (!id || (options.readyPages && !options.readyPages.has(id))) {
            options.onDiagnostic?.({legacyId: oldId!, pageId: id ?? "", disposition: !origins[0] ? "legacy-origin-required" : id ? "legacy-target-blocked" : "legacy-target-unmapped"});
            if (!origins[0]) throw Error("Supporting document requires legacy origin");
            const href = new URL("/a/" + oldId, origins[0]).href;
            edits.push({start:location.startOffset,end:location.endOffset,text:'href="'+href+'"'});
            return;
          }
        }
        if (id && (reference || (allowed && match))) {
          let href: string | undefined;
          if (!options.readyPages || options.readyPages.has(id)) {
            const path =
              "/a/" + id + (reference ? "" : url!.search + url!.hash);
            href = absolute ? new URL(path, options.targetOrigin).href : path;
          } else {
            options.onDiagnostic?.({
              legacyId: oldId!,
              pageId: id,
              disposition:
                absolute || origins[0]
                  ? "legacy-target-blocked"
                  : "legacy-origin-required",
            });
            if (!absolute && origins[0])
              href = new URL(
                reference
                  ? "/a/" + oldId
                  : url!.pathname + url!.search + url!.hash,
                origins[0],
              ).href;
          }
          if (href !== undefined)
            edits.push({
              start: location.startOffset,
              end: location.endOffset,
              text:
                'href="' +
                href.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
                '"',
            });
        }
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) walk(child);
  };
  walk(document);
  for (const edit of edits.sort((a, b) => b.start - a.start))
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}
