/** Validated presentation choice; callers establish their own transport authority. */
export interface HtmlReaderAppearanceCommand { type: 'mx:reader-mode'; mode: 'light' | 'dark' }
export function applyHtmlReaderAppearance(document: Document, command: unknown): boolean {
  if (!command || typeof command !== 'object') return false;
  const data = command as Partial<HtmlReaderAppearanceCommand>;
  if (data.type !== 'mx:reader-mode' || (data.mode !== 'light' && data.mode !== 'dark')) return false;
  document.documentElement.setAttribute('data-af-dark', data.mode === 'dark' ? 'true' : 'false');
  document.documentElement.style.colorScheme = data.mode;
  return true;
}
/** Reader preferences and hash navigation grant no storage or network authority. */
export function installHtmlReaderCommands(win: Window, appOrigin: string): () => void {
  const receive = (event: MessageEvent) => {
    if (!event.isTrusted || event.source !== win.parent || event.origin !== appOrigin) return;
    const data = event.data as { type?: unknown; mode?: unknown; hash?: unknown } | null;
    if (!data || typeof data !== 'object') return;
    applyHtmlReaderAppearance(win.document, data);
    if (data.type === 'mx:frame-hash' && typeof data.hash === 'string' && /^#\S{1,512}$/.test(data.hash)) {
      if (win.location.hash !== data.hash) win.location.hash = data.hash;
      else try { win.document.getElementById(decodeURIComponent(data.hash.slice(1)))?.scrollIntoView?.(); } catch { /* malformed escape */ }
    }
  };
  win.addEventListener('message', receive);
  return () => win.removeEventListener('message', receive);
}
