/** Watch the story's theme after a Mermaid island mounts, including detached hydration. */
export function watchMermaidMode(host: HTMLElement, changed: () => void, changedWhileLoading: () => boolean): () => void {
  const observer = new MutationObserver(records => {
    if (records.some(record => record.oldValue !== (record.target as Element).getAttribute(record.attributeName ?? ''))) changed();
  });
  const watchAncestors = () => {
    for (let element = host.parentElement; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: ['data-theme', 'data-color-mode', 'class'] });
    }
  };
  const attach = new MutationObserver(() => {
    if (!host.isConnected) return;
    attach.disconnect();
    watchAncestors();
    changed();
  });
  if (host.isConnected) {
    watchAncestors();
    if (changedWhileLoading()) changed();
  } else attach.observe(document.documentElement, { childList: true, subtree: true });
  return () => { observer.disconnect(); attach.disconnect(); };
}
