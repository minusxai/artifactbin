// @ts-check
/** Self-contained so the server can embed startup before any network dependency.
 * @param {(state: 'loading'|'failed'|'ready') => void} changed
 * @param {import('./hosted-startup-contracts.ts').HostedStartupClock} clock
 * @returns {import('./hosted-startup-contracts.ts').HostedStartup}
 */
export function createHostedStartup(changed, clock) {
  let ready = false;
  changed("loading");
  const timer = clock.setTimeout(() => {
    if (!ready) changed("failed");
  }, 30000);
  return {
    ready() {
      if (ready) return;
      ready = true;
      clock.clearTimeout(timer);
      changed("ready");
    },
    fail() {
      if (!ready) {
        clock.clearTimeout(timer);
        changed("failed");
      }
    },
  };
}
/** @param {Document} doc
 * @param {Window} win
 * @param {typeof createHostedStartup} create
 */
export function installHostedStartup(doc, win, create) {
  const panel = doc.getElementById("pg-startup");
  const title = doc.getElementById("pg-startup-title");
  const detail = doc.getElementById("pg-startup-detail");
  const retry = doc.getElementById("pg-startup-retry");
  if (!panel || !title || !detail || !retry) return;
  // The loading screen follows the viewer's own light/dark pick, else the system's.
  try {
    const theme = win.localStorage.getItem("pagegi-theme");
    if (theme === "light" || theme === "dark")
      doc.documentElement.dataset.pagegiTheme = theme;
  } catch {}
  const startup = create((state) => {
    doc.documentElement.dataset.pagegiStartup = state;
    panel.hidden = state === "ready";
    panel.setAttribute("role", state === "failed" ? "alert" : "status");
    title.textContent =
      state === "failed"
        ? "Document could not finish loading"
        : "Loading document";
    detail.textContent =
      state === "failed"
        ? "Check your connection and try again."
        : "Opening your document…";
    retry.hidden = state !== "failed";
  }, win);
  retry.addEventListener("click", () => win.location.reload());
  win.addEventListener("pagegi-startup-ready", () => startup.ready());
  win.addEventListener("pagegi-startup-failed", () => startup.fail());
  win.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLScriptElement &&
        target.hasAttribute("data-pagegi-startup-script")
      )
        startup.fail();
    },
    true,
  );
}
