// @ts-check
// The server supplies an exact trusted origin, never an author-controlled query claim.
import { createAppHTML } from "./surface.js";
const platform = document.documentElement.dataset.platformOrigin;
const channel = crypto.randomUUID();
let mounted = false;
addEventListener("message", (event) => {
  const m = event.data;
  if (
    mounted ||
    event.source !== parent ||
    event.origin !== platform ||
    m?.type !== "pagegi-runner-mount" ||
    m.version !== 1 ||
    m.channel !== channel
  )
    return;
  if (
    typeof m.source !== "string" ||
    typeof m.bridge !== "string" ||
    typeof m.revision !== "string"
  )
    return;
  mounted = true;
  const html = createAppHTML(
    m.source,
    {
      saved: m.snapshot,
      revision: m.revision,
      status: m.status,
      page: typeof m.page === "string" ? m.page : null,
      seed: m.seed ?? null,
      load: m.load ?? null,
      channel: m.appChannel,
      viewer: m.viewer,
      access:m.access,
    },
    m.bridge,
    typeof m.designSystem?.href === "string" && m.designSystem.href.startsWith("data:text/css;base64,")
      ? { name: String(m.designSystem.name), href: m.designSystem.href }
      : null,
    platform,
  );
  document.open();
  document.write(html);
  document.close();
});
if (platform && parent !== window)
  parent.postMessage(
    { type: "pagegi-runner-ready", version: 1, channel },
    platform,
  );
