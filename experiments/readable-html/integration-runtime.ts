import { decode, save } from "./source/codec.mjs";
import { captureDocument } from "./source/capture.mjs";
import { register } from "./markdown/component.mjs";
import { assembleStaticReplay, mountStaticReplay } from "./replay/assembler.ts";
import { createSession } from "./replay/session.ts";
import type { ComposedProof } from "./integration-contracts.ts";
import type { Envelope, DecodedDocument } from "./source/contracts.ts";
import type { ReplaySession } from "./replay/contracts.ts";
declare global {
  interface Window {
    composed: ComposedProof;
  }
}
const runtime = document.currentScript?.textContent ?? "";
let original: DecodedDocument;
let state: Envelope;
let session: ReplaySession;
let replayFrame: HTMLIFrameElement | undefined;
const proof: ComposedProof = (window.composed = {
  ready: false,
  setState(value) {
    if (!session.publish({ epoch: session.epoch, kind: "state", value }))
      throw new Error("State update rejected during history");
    state.app = structuredClone(value);
  },
  exportFile() {
    return save(original.source, state).replace(
      '<script data-pagegi-runtime="2"></script>',
      () => '<script data-pagegi-runtime="2">' + runtime + "</script>",
    );
  },
  enterHistory() {
    const view = session.enter({
      sourceRevision: original.revision,
      snapshot: state.app,
      renderedHtml: document.body.innerHTML,
    });
    replayFrame = mountStaticReplay(document.body, view.html);
    return view;
  },
  leaveHistory() {
    replayFrame?.remove();
    replayFrame = undefined;
    state.app = session.leave();
    return structuredClone(state.app);
  },
  publishDuringHistory() {
    return session.publish({
      epoch: session.epoch,
      kind: "presence",
      value: null,
    });
  },
});
document.addEventListener(
  "DOMContentLoaded",
  async () => {
    try {
      original = await decode(captureDocument(document), { runtime });
      state = structuredClone(original.state);
      proof.source = original.source;
      proof.revision = original.revision;
      session = createSession(
        state.app,
        new Map([[original.revision, original.source]]),
        assembleStaticReplay,
        () => {},
      );
      register({ sourceCaptured: Promise.resolve() });
      for (const script of document.querySelectorAll(
        'script[type="application/pagegi"]',
      ))
        Function("pagegi", script.textContent ?? "")({ init: () => state.app });
      await Promise.resolve();
      proof.ready = true;
    } catch (error) {
      proof.error = String(error);
    }
  },
  { once: true },
);
