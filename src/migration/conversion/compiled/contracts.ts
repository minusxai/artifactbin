import type { CompiledDataControl } from "./data-control-contracts.ts";
import type { CompiledAuthorPlan } from "./author-document-contracts.ts";
import type { CompiledDatasetMutation } from "./dataset-mutations-contracts.ts";
import type { CompiledDatasetBinding } from "./dataset-contracts.ts";
import type { ConversionResult } from "../contracts.ts";
export interface CompiledMigrationInput {
  source: string;
  /** Source-derived Dialog runtime adapter, overwritten during admission. */
  dialogFocus?: boolean;
  /** Source-owned supporting document, overwritten during admission. */
  contexts?: readonly import("./context-contracts.ts").CompiledContextReference[];
  /** Source-owned static diagrams, overwritten before offline preparation. */
  mermaids?: readonly import("./mermaid-contracts.ts").CompiledMermaidPlan[];
  /** Public routing only; matched against trusted bound Value proofs at admission. */
  personBindings?: readonly import("./person-contracts.ts").CompiledPersonBinding[];
  /** Source-derived static slide navigation, overwritten at admission. */
  slideDeck?: import("./slide-deck-contracts.ts").CompiledSlideDeck;
  /** Current executing page only, never an authored page ID or arbitrary membership scope. */
  /** Source-derived historical reader dependency; no current identity service is contacted. */
  viewerUnavailable?:boolean;
  viewerBinding?: import("./viewer-contracts.ts").CompiledViewerBinding;
  membersBinding?: import("./members-contracts.ts").CompiledMembersBinding;
  /** Offline trusted catalog facts only; never serialize these in emitted page JavaScript. */
  boundValueColumns?: readonly import("./bound-value-contracts.ts").BoundValueColumnProof[];
  /** Source-derived transparent presentation roots; never accepted as caller authority. */
  presentationIdentities?: readonly import("./presentation-kit-contracts.ts").PresentationIdentityHost[];
  /** Internal source-admitted plan, overwritten before invoking the compiler. */
  dataControls?: readonly CompiledDataControl[];
  /** Derived from admitted source, never accepted as caller authority. */
  dynamicIdentities?: import("./reactive-source-contracts.ts").LocalDynamicIdentityPlan;
  /** Set only by the explicit author-document offline migration route. */
  authorPlan?: CompiledAuthorPlan;
  coreUrl: string;
  /** Explicit manifest bindings; metadata only, never dataset rows. */
  datasetBindings?: readonly CompiledDatasetBinding[];
  datasetMutations?: readonly CompiledDatasetMutation[];
  /** Explicit importer decision for an archived revision without historical authorization. */
  datasetUnavailable?: { reason: "historical-binding-unavailable" };
  /** Exact archived img URL -> verified ACL media endpoint. Static assembler only. */
  resourceMap?: Readonly<Record<string, string>>;
  theme?: string | null;
  template?: string | null;
  colorMode?: "light" | "dark";
}
export interface ArchivedStaticOutput {
  /** Offline verified font bytes only; no provider URLs. */
  fontResources?: readonly import("./fonts/contracts.ts").InlinedFontReceipt[];
  html: string;
  css: string;
  title: string;
  build: string;
  /** Native wrappers required by the archived CSS. No app chrome or transports. */
  rootAttributes: Record<string, string>;
  capabilities: string[];
}
export interface ArchivedCompilerPort {
  compile(input: CompiledMigrationInput): Promise<ArchivedStaticOutput>;
}
export interface CompiledMigrationOptions {
  legacyRoot?: string;
  compiler?: ArchivedCompilerPort;
  timeoutMs?: number;
}
export interface CompiledMigrationResult extends ConversionResult {
  provenance?: {
    compiler: "archived-static";
    build: string;
    mode: "static-only";
    fontResources?: readonly import("./fonts/contracts.ts").InlinedFontReceipt[];
  };
}
export const MAX_COMPILED_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_COMPILED_OUTPUT_BYTES = 32 * 1024 * 1024;
export const MAX_COMPILER_TIME_MS = 60_000;
