import { readerMode } from '@/lib/story-runtime/reader-mode';

/** Observe the owning document and inherited theme for a hydrated Mermaid figure. */
export function observeMermaidMode(host: HTMLElement, changed: (mode: 'light' | 'dark') => void, signal: AbortSignal): void {
  if (signal.aborted) return;
  const html = host.ownerDocument.documentElement;
  const mode = (): 'light' | 'dark' => (host.ownerDocument.defaultView ? readerMode(host.ownerDocument.defaultView) : null)
    ?? (html.classList.contains('dark') ? 'dark' : 'light');
  const observer = new MutationObserver(records => {
    if (records.some(record => record.oldValue !== (record.target as Element).getAttribute(record.attributeName ?? ''))) changed(mode());
  });
  const options: MutationObserverInit = { attributes: true, attributeOldValue: true, attributeFilter: ['data-theme', 'data-color-mode', 'class'] };
  observer.observe(html, options);
  for (let element = host.parentElement; element; element = element.parentElement) if (element !== html) observer.observe(element, options);
  if (mode() !== host.getAttribute('data-m')) changed(mode());
  signal.addEventListener('abort', () => observer.disconnect(), { once: true });
}
