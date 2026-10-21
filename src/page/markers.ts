/** How the platform recognises its own markup in a page (shared by the page model and the skill scripts). */
import {
  AF_BACKEND_REL,
  AF_CORE_PATH,
  AF_DESIGN_SYSTEM_MARKER,
  AF_INLINE_CORE_MARKER,
  AF_MARKER,
  AF_META_MARKER,
  AF_STATE_MARKER,
} from "../af-contracts.ts";
import { attribute, relTokens } from "./html-source.ts";
import type { Element } from "./html-source.ts";

export const URL_BASE = "https://base.invalid/";

export const marker = (element: Element) => attribute(element, AF_MARKER);
export const isScript = (element: Element) => element.tagName === "script";
export const isMetaBlock = (element: Element) => isScript(element) && marker(element) === AF_META_MARKER;
export const isStateBlock = (element: Element) => isScript(element) && marker(element) === AF_STATE_MARKER;
export const isDesignSystemLink = (element: Element) =>
  element.tagName === "link" && marker(element) === AF_DESIGN_SYSTEM_MARKER;
export const isBackendLink = (element: Element) =>
  element.tagName === "link" && relTokens(element).includes(AF_BACKEND_REL);

/** An absolute (or root-relative) http(s) URL without query or fragment, or null. */
export function platformUrl(value: string | null): URL | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/[?#]/.test(trimmed)) return null;
  if (!/^(?:https?:)?\/\//i.test(trimmed) && !trimmed.startsWith("/")) return null;
  try {
    const url = new URL(trimmed, URL_BASE);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function isExternalCore(element: Element): boolean {
  return isScript(element) && platformUrl(attribute(element, "src"))?.pathname === AF_CORE_PATH;
}
export function isCore(element: Element): boolean {
  return isExternalCore(element) || (isScript(element) && marker(element) === AF_INLINE_CORE_MARKER);
}

