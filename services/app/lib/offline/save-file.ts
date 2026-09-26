/**
 * SAVE, from inside the file: the current ArtifactFile written back into the
 * same shell the download came in (lib/offline/file-html — one writer for
 * both), with the file's own code block, so the saved copy opens anywhere the
 * original did and can be sent on for the next person to add to.
 *
 * Where the browser has a save picker (Chromium: `showSaveFilePicker`), the
 * picker is offered with the file's own name, so the reader can overwrite the
 * copy they opened; the handle is kept, and later saves write to it again.
 * Elsewhere the file is downloaded through a Blob URL. Probed from file://
 * (scripts/gate-offline-file.mjs records it per engine): the page's CSP does
 * not govern a download, and Chromium, Firefox and WebKit all accept the Blob
 * download; the `data:` URL fallback exists for a browser that refuses one.
 */
import type { ArtifactFile } from './file-format';
import { renderArtifactFileHtml } from './file-html';

export type SaveOutcome = 'written' | 'downloaded' | 'cancelled';

interface WritableFile { write(data: Blob | string): Promise<void>; close(): Promise<void> }
export interface SaveHandle { createWritable(): Promise<WritableFile> }
type SavePicker = (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<SaveHandle>;

/** The file name to suggest: the one this copy was opened from, else the document's title. */
export function suggestedFileName(title: string, location: Pick<Location, 'protocol' | 'pathname'> | null = typeof window === 'undefined' ? null : window.location): string {
  if (location?.protocol === 'file:') {
    try {
      const name = decodeURIComponent(location.pathname.split('/').pop() ?? '');
      if (/\.html?$/i.test(name)) return name;
    } catch { /* an undecodable path: fall back to the title */ }
  }
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${safe || 'artifactbin document'}.html`;
}

function download(html: string, name: string, doc: Document): void {
  const anchor = doc.createElement('a');
  anchor.download = name;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    anchor.href = url;
  } catch {
    // No Blob URLs here: the same bytes as a data: URL, which every engine downloads.
    anchor.href = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }
  doc.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoked after the download has had its turn; revoking synchronously cancels it in some engines.
  if (url) setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Writes the file. `handle` is the picker handle from an earlier save (the
 * same file is written again without asking); the returned handle is the one
 * to pass next time.
 */
export async function saveArtifactFile(
  input: { file: ArtifactFile; code: string; name: string; handle?: SaveHandle | null },
  env: { picker?: SavePicker | null; doc?: Document } = {},
): Promise<{ outcome: SaveOutcome; handle: SaveHandle | null }> {
  const html = renderArtifactFileHtml({ file: input.file, code: input.code });
  const picker = env.picker !== undefined ? env.picker
    : typeof window !== 'undefined' && typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function'
      ? ((options) => (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker(options)) as SavePicker
      : null;
  if (picker) {
    let handle = input.handle ?? null;
    try {
      handle ??= await picker({ suggestedName: input.name, types: [{ description: 'Web page', accept: { 'text/html': ['.html'] } }] });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return { outcome: 'cancelled', handle: null };
      throw error;
    }
    const writable = await handle.createWritable();
    await writable.write(new Blob([html], { type: 'text/html' }));
    await writable.close();
    return { outcome: 'written', handle };
  }
  download(html, input.name, env.doc ?? document);
  return { outcome: 'downloaded', handle: null };
}
