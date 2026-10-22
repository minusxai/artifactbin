import type { CompiledScalarControl } from "./scalar-control-contracts.ts";
import type { CompiledDataControl } from "./data-control-contracts.ts";
import type {
  PresentationIdentityHost,
  PresentationKitCapability,
} from "./presentation-kit-contracts.ts";
export interface LocalComponentContext {
  readonly ancestors: readonly string[];
  readonly parentTag?: string;
  readonly rowTable?: string;
}
/** Family-local facts; source traversal owns symbol resolution and lexical scopes. */
export interface LocalComponentAdmission {
  readonly selectedPerson?: string;
  readonly references: readonly string[];
  readonly scalarBindings: readonly string[];
  readonly scalarControls: readonly CompiledScalarControl[];
  readonly dataControls: readonly CompiledDataControl[];
  readonly presentationIdentityHosts: readonly PresentationIdentityHost[];
  readonly identityLifecycle?: PresentationKitCapability;
  readonly descendantScope?: {
    readonly kind: "row";
    readonly table: string;
    readonly key?: string;
  };
}
export type AdmitLocalComponent = (
  node: unknown,
  context: LocalComponentContext,
) => LocalComponentAdmission | null;
