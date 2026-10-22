// @ts-check
/** The HTML the runner writes: the page's own source, with the bridge and its
 * boot data placed first in <head> so they run before the core and the page,
 * and the page's own design system's CSS inline just before the core, so the
 * first paint is styled and the core fetches nothing for it (the core sees a
 * link only when it precedes it: what follows a script is not parsed yet
 * when it runs). Node IDs (data-af-id) come from the saved source; nothing
 * is stamped here.
 * @param {string} source
 * @param {{revision:string,[key:string]:unknown}} boot
 * @param {string} bridge
 * @param {{name:string,href:string} | null} [designSystem]
 * @param {string} [platformOrigin] Trusted server-issued origin for root-relative core URLs.
 */
export function createAppHTML(source, boot, bridge, designSystem = null, platformOrigin = "") {
  const doc = new DOMParser().parseFromString(source, "text/html");
  doc.querySelectorAll("base").forEach((el) => el.remove());
  if (platformOrigin) {
    for (const script of doc.querySelectorAll("script[src]")) {
      const src = script.getAttribute("src")?.trim() ?? "";
      if (src === "/af/v1/core.js")
        script.setAttribute("src", new URL(src, platformOrigin).href);
    }
  }
  if (designSystem) {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.setAttribute("data-af", "design-system");
    link.setAttribute("blocking", "render");
    link.href = designSystem.href;
    const core = [...doc.head.querySelectorAll("script[src]")].find((el) => {
      try {
        return new URL(el.getAttribute("src") || "", "https://base.invalid/").pathname === "/af/v1/core.js";
      } catch {
        return false;
      }
    });
    if (core) core.before(link);
    else doc.head.prepend(link);
  }
  const config = doc.createElement("script");
  config.id = "pagegi-boot";
  config.type = "application/json";
  config.textContent = JSON.stringify({ ...boot, sourceStyles: [...doc.querySelectorAll("style")].map(style => style.textContent ?? "") }).replaceAll("<", "\\u003c");
  const script = doc.createElement("script");
  // Deliberate app execution: runner.js accepts this bridge only from its exact
  // server-issued platform origin, parent window, and one-time handshake channel.
  // The build supplies PAGEGI_BRIDGE; author code runs on the isolated app origin.
  script.textContent = bridge;
  doc.head.prepend(config, script);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
