import { parseMarkdownLite, isPersonMentionHref } from "./markdown.ts";
import type { MdInline, MdNode } from "./markdown-contracts.ts";
import type { CommentBodyPresentation } from "./presentation-contracts.ts";
/** Only the IDs actually authored as mentions; code, raw @text and retired session links are not lookups. */
export function personMentionIds(body: string): string[] {
  const ids = new Set<string>();
  const inline = (nodes: MdInline[]) => {
    for (const node of nodes) {
      if (node.kind === "link" && isPersonMentionHref(node.href))
        ids.add(node.href.slice(8));
      if ("children" in node) inline(node.children);
    }
  };
  const blocks = (nodes: MdNode[]) => {
    for (const node of nodes) {
      if (node.kind === "paragraph" || node.kind === "heading")
        inline(node.children);
      else if (node.kind === "list")
        for (const item of node.items) blocks(item.children);
      else if (node.kind === "quote") blocks(node.children);
    }
  };
  blocks(parseMarkdownLite(body));
  return [...ids];
}
/** Public path grammar only; projection is never allowed to provide a scheme, email or arbitrary route. */
export function canonicalPersonHref(value: string): string | null {
  const handle = value.startsWith("/@") ? value.slice(2) : "";
  return handle.length >= 3 &&
    handle.length <= 32 &&
    /^[a-z0-9_]+(?:-[a-z0-9_]+)*$/.test(handle)
    ? value
    : null;
}
/** Build allowlisted DOM nodes from parsed text. No innerHTML, document parsing, author styles or fetch. */
export function renderCommentBody(
  parent: HTMLElement,
  presentation: CommentBodyPresentation,
): void {
  const document = parent.ownerDocument;
  const links = new Map(
    (presentation.personLinks || []).map((link) => [
      link.legacyUserId,
      canonicalPersonHref(link.href),
    ]),
  );
  const inline = (nodes: MdInline[], into: HTMLElement) => {
    for (const node of nodes) {
      if (node.kind === "text") {
        into.append(document.createTextNode(node.text));
        continue;
      }
      if (node.kind === "break") {
        into.append(document.createElement("br"));
        continue;
      }
      if (node.kind === "code") {
        const element = document.createElement("code");
        element.textContent = node.text;
        into.append(element);
        continue;
      }
      if (node.kind === "link") {
        const href = isPersonMentionHref(node.href)
          ? links.get(node.href.slice(8))
          : /^(?:https?:|mailto:)/i.test(node.href)
            ? node.href
            : null;
        if (!href) {
          inline(node.children, into);
          continue;
        }
        const element = document.createElement("a");
        element.href = href;
        if (/^https?:/i.test(href)) {
          element.target = "_blank";
          element.rel = "noopener noreferrer";
        }
        element.referrerPolicy = "no-referrer";
        inline(node.children, element);
        into.append(element);
        continue;
      }
      const element = document.createElement(
        node.kind === "strong" ? "strong" : "em",
      );
      inline(node.children, element);
      into.append(element);
    }
  };
  const blocks = (nodes: MdNode[], into: HTMLElement) => {
    for (const node of nodes) {
      if (node.kind === "paragraph" || node.kind === "heading") {
        const element = document.createElement(
          node.kind === "paragraph" ? "p" : "div",
        );
        if (node.kind === "heading") {
          element.setAttribute("role", "heading");
          element.setAttribute("aria-level", String(node.level));
        }
        inline(node.children, element);
        into.append(element);
      } else if (node.kind === "code_block") {
        const element = document.createElement("pre"),
          code = document.createElement("code");
        code.textContent = node.text;

        element.append(code);
        into.append(element);
      } else if (node.kind === "quote") {
        const element = document.createElement("blockquote");
        blocks(node.children, element);
        into.append(element);
      } else {
        const element = document.createElement(node.ordered ? "ol" : "ul");
        for (const item of node.items) {
          const li = document.createElement("li");
          blocks(item.children, li);
          element.append(li);
        }
        into.append(element);
      }
    }
  };
  const body = document.createElement("div");
  body.className = "pg-comment-body";

  blocks(parseMarkdownLite(presentation.body), body);
  parent.append(body);
}
