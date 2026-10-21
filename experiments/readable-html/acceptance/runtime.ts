import { decode, save } from "../source/codec.mjs";
import { captureDocument } from "../source/capture.mjs";
import { register } from "../markdown/component.mjs";
import { assembleStaticReplay, mountStaticReplay } from "../replay/assembler.ts";
import { createSession } from "../replay/session.ts";
import type { ContextProof, PortableContext } from "./contracts.ts";
import type { ComposedProof } from "../integration-contracts.ts";
import type { Envelope, DecodedDocument } from "../source/contracts.ts";
import type { ReplaySession } from "../replay/contracts.ts";
declare global {
  interface Window {
    composed: ComposedProof & ContextProof;
  }
}
const runtime = document.currentScript?.textContent ?? "";
let original: DecodedDocument;
let state: Envelope;
let session: ReplaySession;
let replayFrame: HTMLIFrameElement | undefined;
const sources = new Map<string,string>();
const contexts = new Map<string,PortableContext>();
async function validateContext(context: PortableContext) {
  if(!context || typeof context.id!=="string" || !context.id || typeof context.targetId!=="string" || typeof context.body!=="string") throw Error("Invalid comment context");
  const normalized = await decode(save(context.source,{format:2,app:context.snapshot,comments:[]}));
  if(normalized.revision!==context.sourceRevision) throw Error("Historical revision mismatch");
  const previous=contexts.get(context.id);
  if(previous && JSON.stringify(previous)!==JSON.stringify(context)) throw Error("Immutable comment context conflict");
  return structuredClone(context);
}
const proof: ComposedProof & ContextProof = (window.composed = {
  ready: false,
  async installContext(context) {
    const epoch=session.epoch;
    const valid=await validateContext(context);
    const previous=contexts.get(valid.id);
    if(previous && JSON.stringify(previous)!==JSON.stringify(valid))throw Error("Immutable comment context conflict");
    if(!session.publish({epoch,kind:"comment",value:JSON.parse(JSON.stringify(valid))})) throw Error("History is read-only");
    contexts.set(valid.id,valid);sources.set(valid.sourceRevision,valid.source);
    state.comments=JSON.parse(JSON.stringify([...contexts.values()]));
  },
  enterComment(id) {
    const context=contexts.get(id);if(!context)throw Error("Missing comment context");
    const view=session.enter({sourceRevision:context.sourceRevision,snapshot:context.snapshot});
    replayFrame?.remove();replayFrame=mountStaticReplay(document.body,view.html);return view;
  },
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
      sources.set(original.revision,original.source);
      for(const item of state.comments){const context=await validateContext(item as unknown as PortableContext);contexts.set(context.id,context);sources.set(context.sourceRevision,context.source);}
      session = createSession(
        state.app,
        sources,
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
