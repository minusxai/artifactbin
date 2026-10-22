// @ts-check
import { runnerURL } from "../navigation.js";
import { installBridge } from "./bridge.js";
import { assembleStaticReplay, replayDesignSystem } from "./replay.ts";
/** The page frame's allowances; the hosted shell (src/hosted.js) declares the same list. */
export const PAGE_FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-downloads allow-forms";
/** One app-facing surface: the hosted runner handshake, the local placement
 * (a downloaded file: the page is this document, and the bridge joins its
 * realm) and the nonexecuting history view stay private. */
/** @param {import("./lifecycle-contracts.ts").PlacementOptions} options
 * @returns {import("./lifecycle-contracts.ts").AppSurface} */
export function createPlacement({
  local = false,
  shell,
  frame,
  historyFrame,
  localState,
  viewer,
  bridge,
  designSystem = null,
  designSystemCss = async () => null,
}) {
  let channel = crypto.randomUUID();
  /** Counts mounts, so a saved view whose stylesheet arrives late never replaces a newer mount. */
  let mounts = 0;
  /** @type {((event:MessageEvent)=>void)|null} */
  let pendingReady = null;
  let installed = false;
  const appWindow = () => (local ? window : frame.contentWindow);
  const send = (data) => appWindow()?.postMessage({ channel, ...data }, "*");
  return {
    send,
    accepts(event) {
      return (
        event.source === appWindow() &&
        event.data?.pagegi &&
        event.data.channel === channel
      );
    },
    mount(source, snapshot, revision, history = false) {
      if (pendingReady) {
        removeEventListener("message", pendingReady);
        pendingReady = null;
      }
      const mount = ++mounts;
      if (history) {
        historyFrame.hidden = false;
        historyFrame.removeAttribute("srcdoc");
        // What the commenter saw, styled with the design system it was shown in.
        const captured = snapshot?.rendered || source;
        void designSystemCss(replayDesignSystem(captured))
          .catch(() => null)
          .then((css) => {
            if (mount === mounts)
              historyFrame.srcdoc = assembleStaticReplay(captured, css, source);
          });
        return;
      }
      historyFrame.hidden = true;
      historyFrame.removeAttribute("srcdoc");
      if (local) {
        if (installed) {
          send({ pagegi: true, kind: "restore", snapshot });
          return;
        }
        installed = true;
        installBridge({
          saved: snapshot,
          revision,
          channel,
          local: true,
          sourceStyles: [...new DOMParser().parseFromString(source, "text/html").querySelectorAll("style")].map(style => style.textContent ?? ""),
          viewer: viewer(),
        });
        return;
      }
      channel = crypto.randomUUID();
      frame.setAttribute("sandbox", PAGE_FRAME_SANDBOX);
      frame.removeAttribute("srcdoc");
      const runner = shell?.runner;
      if (!runner) throw Error("Hosted document runner is missing");
      const runnerAddress = runnerURL(runner, location.href);
      const expected = runnerAddress.origin;
      pendingReady = (event) => {
        const m = event.data;
        if (
          event.source !== frame.contentWindow ||
          event.origin !== expected ||
          m?.type !== "pagegi-runner-ready" ||
          m.version !== 1
        )
          return;
        if (pendingReady) removeEventListener("message", pendingReady);
        pendingReady = null;
        frame.contentWindow?.postMessage(
          {
            type: "pagegi-runner-mount",
            version: 1,
            channel: m.channel,
            source,
            snapshot,
            revision,
            ...localState(),
            viewer: viewer(),
            bridge,
            designSystem,
            appChannel: channel,
          },
          expected,
        );
      };
      addEventListener("message", pendingReady);
      frame.src = runnerAddress.href;
    },
  };
}
