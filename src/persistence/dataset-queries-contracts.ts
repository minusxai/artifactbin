import type { BackendPrincipal } from "../backend/contracts.ts";
import type {
  RegisteredServerQueryPlan,
  RegisteredServerQueryContext,
} from "../datasets/query/contracts.ts";
/** Constructed by the saved invocation authority, never by resolver arguments. */
export interface SavedQueryInvocation {
  readonly pageId: string;
  readonly backendId: string;
  readonly backendVersion: string;
  readonly principal: BackendPrincipal;
  /** Platform session lookup key. Never sent to an isolate or stored in query metadata. */
  readonly tokenHash: string | null;
}
/** Offline compiler/importer output. Canonical page digest and raw module digest are distinct. */
export interface SavedQueryRegistration {
  readonly sourceNamespace: string;
  readonly moduleSourceSha256: string;
  readonly plan: RegisteredServerQueryPlan;
}
export interface SavedQueryAuthority {
  readonly context: RegisteredServerQueryContext;
  readonly registration: SavedQueryRegistration;
  readonly userId: string | null;
}
