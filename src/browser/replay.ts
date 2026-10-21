/**
 * A saved view: what a commenter (or another viewer) saw, shown read-only to
 * someone else. The page captures its own rendered document with the state of
 * its form controls (`captureRenderedDocument`); the viewer's platform makes
 * that capture inert (`assembleStaticReplay`) and shows it in a frame with an
 * empty sandbox (no scripts, forms, navigation or popups, an opaque origin) and
 * a policy that allows inline styles and nothing that reaches the network.
 * The page's own styles, classes and attributes stay, and the design system's
 * CSS is put back inline, so the view looks like the live page did.
 */
import { isDesignSystem } from "./core/appearance.ts";
import { DEFAULT_DESIGN_SYSTEM } from "../af-contracts.ts";
import type { DesignSystemName } from "../af-contracts.ts";

/** Elements that run, load or embed something; they never reach a saved view. */
const dropped = new Set(
  "script link meta base title iframe frame frameset object embed applet template noscript portal audio video source track canvas".split(
    " ",
  ),
);
/** Attributes that load, navigate or act; style, class, data-* and aria-* stay. */
const droppedAttributes = new Set(
  "href xlink:href src srcset srcdoc action formaction ping background poster data codebase manifest http-equiv autofocus nonce integrity target download".split(
    " ",
  ),
);
const POLICY =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

/** The design system a capture (or a page's source) shows: its <html> attribute, else the default. */
export function replayDesignSystem(source: string): DesignSystemName {
  const name = /<html\b[^>]*\sdata-af-design-system\s*=\s*["']?([a-z]+)/i.exec(
    source,
  )?.[1];
  return isDesignSystem(name) ? name : DEFAULT_DESIGN_SYSTEM;
}

/**
 * An inert, styled document for a saved view. `designSystemCss` is the
 * design system's stylesheet, put inline before the page's own styles.
 */
export function assembleStaticReplay(
  source: string,
  designSystemCss: string | null = null,
): string {
  // A parsed, never-rendered document is inert: nothing in it loads or runs.
  const input = new DOMParser().parseFromString(source, "text/html");
  const output = document.implementation.createHTMLDocument("");
  function copyAttributes(from: Element, to: Element): void {
    for (const attribute of from.attributes) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || droppedAttributes.has(name)) continue;
      try {
        if (attribute.namespaceURI)
          to.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
        else to.setAttribute(attribute.name, attribute.value);
      } catch {
        /* A name the output document refuses is simply left out. */
      }
    }
  }
  function append(node: Node, parent: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(output.createTextNode(node.textContent ?? ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element,
      tag = element.localName;
    if (dropped.has(tag)) return;
    if (tag === "img") {
      const alt = element.getAttribute("alt");
      if (alt) parent.appendChild(output.createTextNode(alt));
      return;
    }
    let next: Element;
    try {
      next = output.createElementNS(element.namespaceURI, tag);
    } catch {
      next = output.createElement("span");
    }
    copyAttributes(element, next);
    parent.appendChild(next);
    for (const child of element.childNodes) append(child, next);
  }
  copyAttributes(input.documentElement, output.documentElement);
  const head = output.head;
  const charset = output.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  const policy = output.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", POLICY);
  const title = output.createElement("title");
  title.textContent = "Saved view";
  head.append(charset, policy, title);
  if (designSystemCss) {
    const style = output.createElement("style");
    style.setAttribute("data-af", "design-system");
    style.textContent = designSystemCss;
    head.append(style);
  }
  // The page's own styles from its <head>, in order, after the design system.
  for (const style of input.head.querySelectorAll("style")) {
    const copy = output.createElement("style");
    if (style.getAttribute("media")) copy.setAttribute("media", style.getAttribute("media")!);
    copy.textContent = style.textContent;
    head.append(copy);
  }
  copyAttributes(input.body, output.body);
  for (const node of input.body.childNodes) append(node, output.body);
  return "<!doctype html>" + output.documentElement.outerHTML;
}

/** The adapter owns sandbox policy; callers never choose allowances. */
export function mountStaticReplay(
  parent: HTMLElement,
  html: string,
): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.title = "Static saved view";
  frame.setAttribute("sandbox", "");
  frame.srcdoc = html;
  parent.append(frame);
  return frame;
}

/**
 * Capture the page as rendered, without platform UI or scripts: the whole
 * document (its <html> attributes carry the design system and dark mode, its
 * <head> the page's styles) with each form control's current value written
 * into its markup. Undefined when there is no body yet or it is too large.
 */
export function captureRenderedDocument(doc: Document): string | undefined {
  // A page whose core runs in <head> can be asked before <body> exists.
  if (!doc.body) return undefined;
  const root = doc.documentElement;
  const copy = root.cloneNode(true) as HTMLElement;
  const originals = [...root.querySelectorAll("input,textarea,select")];
  [...copy.querySelectorAll("input,textarea,select")].forEach((control, index) => {
    const original = originals[index];
    if (original instanceof HTMLInputElement) {
      if (original.type === "password" || original.type === "file")
        control.removeAttribute("value");
      else if (["checkbox", "radio"].includes(original.type))
        if (original.checked) control.setAttribute("checked", "");
        else control.removeAttribute("checked");
      else control.setAttribute("value", original.value);
    } else if (original instanceof HTMLTextAreaElement)
      control.textContent = original.value;
    else if (original instanceof HTMLSelectElement)
      [...control.querySelectorAll("option")].forEach((option, i) => {
        if (original.options[i]?.selected) option.setAttribute("selected", "");
        else option.removeAttribute("selected");
      });
  });
  copy
    .querySelectorAll(
      "[data-pagegi-ui],script,link,noscript,template,iframe,object,embed",
    )
    .forEach((node) => node.remove());
  copy.classList.remove("pagegi-commenting");
  if (!copy.classList.length) copy.removeAttribute("class");
  const rendered = copy.outerHTML;
  return rendered.length <= 200000 ? rendered : undefined;
}
