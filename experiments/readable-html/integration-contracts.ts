import type { Envelope } from "./source/contracts.ts";
import type { ReplayDocument } from "./replay/contracts.ts";
/** Browser-only candidate composition; no product entrypoint imports this. */
export interface ComposedProof {
  ready: boolean;
  error?: string;
  revision?: string;
  source?: string;
  setState(value: Envelope["app"]): void;
  exportFile(): string;
  enterHistory(): ReplayDocument;
  leaveHistory(): Envelope["app"];
  publishDuringHistory(): boolean;
}
