/** Reader preferences and hash navigation grant no storage or network authority. */
export function installHtmlReaderCommands(win: Window, appOrigin: string): () => void {
  const receive = (event: MessageEvent) => {
    if (!event.isTrusted || event.source !== win.parent || event.origin !== appOrigin) return;
    const data = event.data as { type?: unknown; mode?: unknown; hash?: unknown } | null;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'mx:reader-mode' && (data.mode === 'dark' || data.mode === 'light')) {
      if (data.mode === 'dark') win.document.documentElement.setAttribute('data-af-dark', 'true');
      else win.document.documentElement.removeAttribute('data-af-dark');
      win.document.documentElement.style.colorScheme = data.mode;
    }
    if (data.type === 'mx:frame-hash' && typeof data.hash === 'string' && /^#\S{1,512}$/.test(data.hash)) {
      if (win.location.hash !== data.hash) win.location.hash = data.hash;
      else try { win.document.getElementById(decodeURIComponent(data.hash.slice(1)))?.scrollIntoView?.(); } catch { /* malformed escape */ }
    }
  };
  win.addEventListener('message', receive);
  return () => win.removeEventListener('message', receive);
}
