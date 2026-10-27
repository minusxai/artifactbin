/** Validated presentation choice; callers establish their own transport authority. */
interface HtmlReaderAppearanceCommand { type: 'mx:reader-mode'; mode: 'light' | 'dark' }
/** The owner switched the page's design system in the top bar (D4); `mode` is the viewer's pick, else the system's default. */
interface HtmlDesignSystemCommand { type: 'mx:design-system'; name: string; mode: 'light' | 'dark' }
const setMode = (document: Document, mode: 'light' | 'dark') => {
  document.documentElement.setAttribute('data-af-dark', mode === 'dark' ? 'true' : 'false');
  document.documentElement.style.colorScheme = mode;
};
export function applyHtmlReaderAppearance(document: Document, command: unknown): boolean {
  if (!command || typeof command !== 'object') return false;
  const data = command as Partial<HtmlReaderAppearanceCommand> | Partial<HtmlDesignSystemCommand>;
  if (data.mode !== 'light' && data.mode !== 'dark') return false;
  if (data.type === 'mx:design-system') {
    const name = (data as Partial<HtmlDesignSystemCommand>).name;
    // A name shape only: an unknown system matches no platform rule (keeps the system table out of the core and reader).
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(name)) return false;
    document.documentElement.setAttribute('data-af-design-system', name);
    setMode(document, data.mode);
    return true;
  }
  if (data.type !== 'mx:reader-mode') return false;
  setMode(document, data.mode);
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
