/** The document's stylesheet names its design on :root and its color mode on the root class. */
import { escapeHtml } from '@artifactbin/utils/escape';
import { applyColorMode } from '@/lib/story-runtime/reader-mode';

type ColorMode = 'light' | 'dark' | null | undefined;

/** Shared by served reader assembly and downloaded/saved file shells. */
export function documentRootAttributes(colorMode: ColorMode, theme: string | null | undefined): string {
  return `class="${escapeHtml(colorMode ?? 'light')}"${theme ? ` data-theme="${escapeHtml(theme)}"` : ''}`;
}

/** A restored draft or metadata edit uses the same root contract as its serialized file. */
export function applyDocumentRootAppearance(root: HTMLElement, colorMode: ColorMode, theme: string | null | undefined): void {
  applyColorMode(root, colorMode ?? 'light');
  if (theme) root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}
