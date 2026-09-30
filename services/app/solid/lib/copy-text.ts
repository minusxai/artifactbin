/**
 * Copy text to the clipboard. Never throws: resolves true when the text was copied, false otherwise.
 * Tries the async Clipboard API, then falls back to selecting a hidden field and `execCommand('copy')`
 * for a browser or context (plain http, an older webview) without it — the same last resort the
 * reader's share button uses (lib/story-runtime/reader-share).
 */
function copyByExecCommand(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(field);
  try {
    field.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  return copyByExecCommand(text);
}
