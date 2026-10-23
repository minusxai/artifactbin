/** Saved compiled pages created this converter-owned recovery control without
 * a marker. Keep successful pages free of recovery UI and retain failed-read
 * retries without relying on either the platform or archived design system. */
export function installMigrationRecovery(doc: Document): void {
  const update = () => {
    for (const status of doc.querySelectorAll('body > p[data-migration-dataset-status][role="status"]')) {
      if ([...status.attributes].some(a => !["role", "data-migration-dataset-status", "hidden", "data-af-id"].includes(a.name))) continue;
      const retry = status.nextElementSibling;
      if (!(retry instanceof HTMLButtonElement) || retry.type !== "button" ||
          retry.textContent !== "Refresh data" ||
          [...retry.attributes].some(a => !["type", "data-migration-dataset-retry", "hidden", "style"].includes(a.name))) continue;
      if (!retry.hasAttribute("data-migration-dataset-retry") && [...retry.attributes].some(a => a.name !== "type")) continue;
      retry.setAttribute("data-migration-dataset-retry", "");
      const failed = !status.hasAttribute("hidden") && [
        "Protected data queries could not be evaluated.",
        "Protected data is unavailable. Check access and refresh data.",
      ].includes(status.textContent ?? "");
      if (retry.hidden === failed) retry.hidden = !failed;
      retry.style.cssText = "all:initial;box-sizing:border-box;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;padding:6px 10px;margin:0 0 12px;cursor:pointer;outline:revert;outline-offset:2px;display:" + (failed ? "inline-flex" : "none");
    }
  };
  const start = () => {
    if (!doc.querySelector('body > p[data-migration-dataset-status][role="status"]')) return;
    const observer = new MutationObserver(records => {
      if (records.some(record => record.target === doc.body ||
          (record.target instanceof Element ? record.target : record.target.parentElement)?.matches('p[data-migration-dataset-status]'))) update();
    });
    observer.observe(doc.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ["hidden"],
    });
    doc.defaultView?.addEventListener("pagehide", event => {
      if (!event.persisted) observer.disconnect();
    });
    update();
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
