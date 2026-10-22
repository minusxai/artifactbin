import { readFileSync } from "node:fs";
import { parse } from "parse5";
import { documentTitle } from "./text.ts";
import type { DefaultTreeAdapterMap } from "parse5";
import type {
  SocialPreview,
  SocialPreviewAddress,
  SocialCard,
  SocialCardAccess,
} from "./social-preview-contracts.ts";

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const bounded = (value: string, limit: number): string =>
  value.replace(/\s+/g, " ").trim().slice(0, limit);

/** Parse inert metadata only. Never follow authored URLs or execute page scripts. Authorization belongs to the caller. */
export function socialPreview(
  source: string,
  address: SocialPreviewAddress,
): SocialPreview {
  const tree = parse(source);
  let description = "";
  const visit = (node: DefaultTreeAdapterMap["node"]): void => {
    if ("tagName" in node && node.tagName === "meta") {
      const attribute = (name: string) =>
        node.attrs.find((attr) => attr.name === name)?.value;
      if (!description && attribute("name")?.toLowerCase() === "description")
        description = bounded(attribute("content") || "", 300);
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  // Only head metadata; descriptions in templates and authored body elements are ignored.
  const head = tree.childNodes.find(
    (node) => "tagName" in node && node.tagName === "html",
  );
  if (head && "childNodes" in head) {
    const element = head.childNodes.find(
      (node) => "tagName" in node && node.tagName === "head",
    );
    if (element) visit(element);
  }
  return {
    title: bounded(documentTitle(source), 160),
    description,
    ...address,
  };
}

export function socialPreviewHead(preview: SocialPreview): string {
  const meta = (key: string, value: string, property = false): string =>
    `<meta ${property ? "property" : "name"}="${key}" content="${escape(value)}">`;
  return (
    meta("description", preview.description) +
    meta("og:type", "website", true) +
    meta("og:title", preview.title, true) +
    meta("og:description", preview.description, true) +
    meta("og:url", preview.url, true) +
    meta("twitter:card", preview.imageUrl ? "summary_large_image" : "summary") +
    meta("twitter:title", preview.title) +
    meta("twitter:description", preview.description) +
    (preview.imageUrl
      ? meta("og:image", preview.imageUrl, true) +
        meta("og:image:alt", "Document preview", true) +
        meta("twitter:image", preview.imageUrl)
      : "")
  );
}

const cardBytes = readFileSync(
  new URL("./assets/social-preview.png", import.meta.url),
);
/** Generic static illustration, never a screenshot or a representation of page contents. */
export async function socialPreviewCard(
  access: SocialCardAccess,
): Promise<SocialCard> {
  await access.authorize();
  return {
    contentType: "image/png",
    cacheControl: "private, no-store",
    bytes: new Uint8Array(cardBytes),
  };
}
