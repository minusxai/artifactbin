import { captureDocument } from "./capture.mjs";
import { decode, save } from "./codec.mjs";
// The source authority is captured once before *any* managed application code.
const runtime = document.currentScript.textContent;
const status = (window.candidate = { ready: false });
document.addEventListener(
  "DOMContentLoaded",
  async () => {
    try {
      const captured = captureDocument(document);
      const original = await decode(captured, { runtime });
      status.state = original.state;
      status.source = original.source;
      status.revision = original.revision;
      status.save = () =>
        save(original.source, status.state).replace(
          '<script data-pagegi-runtime="2">' + "<" + "/script>",
          () => '<script data-pagegi-runtime="2">' + runtime + "<" + "/script>",
        );
      for (const script of document.querySelectorAll(
        'script[type="application/pagegi"]',
      )) {
        if (script.closest("template")) continue;
        Function(
          "pagegi",
          script.textContent,
        )({ init: () => status.state.app });
      }
      status.ready = true;
    } catch (error) {
      status.error = String(error.message || error);
    }
  },
  { once: true },
);
