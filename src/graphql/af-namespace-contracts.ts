/**
 * Page-level GraphQL over linked backend files (owner: brief C).
 * Implementation: src/graphql/af-namespaces.ts (pure; graphql-js only, no I/O).
 *
 * Each linked file is a namespace: its Query fields appear under
 * `Query.<name>` and its Mutation fields under `Mutation.<name>`. Type names
 * are private to the file, so two files may both define `Invoice` or `list`.
 * The platform supplies, and authors never declare:
 *   directive @auth(signedIn: Boolean, role: Role) on FIELD_DEFINITION
 *   enum Role { VIEWER EDITOR OWNER }
 */
import type {
  AfJson,
  AfJsonObject,
  FileId,
  Outcome,
  PageRole,
} from "../af-contracts.ts";

export interface NamespaceSource {
  /** data-af-name; a GraphQL name, unique on the page. */
  name: string;
  fileId: FileId;
  /** Immutable backend version linked from this page version. */
  version: string;
  /** The file's own SDL, written as if the file were alone. */
  typeDefs: string;
}

/** Who is calling, resolved by the server from the credential, never from arguments. */
export interface PageCaller {
  /** The page being viewed: becomes principal.tenant. */
  pageId: FileId;
  /** Signed-in account, or null for an anonymous viewer. */
  subject: string | null;
  /** Role on the page, or null when the caller cannot open it. */
  role: PageRole | null;
}
/** What a resolver receives as its second argument. */
export interface AfPrincipal {
  readonly tenant: FileId;
  readonly subject: string | null;
}

export interface FieldCall {
  namespace: string;
  fileId: FileId;
  version: string;
  operation: "query" | "mutation";
  /** The field name in the file's own schema (not the alias). */
  field: string;
  args: AfJsonObject;
  principal: AfPrincipal;
  signal: AbortSignal;
}

/**
 * A short machine-readable reason a backend field failed, shown to the page as
 * the error's `extensions.code`: a sanitized host code such as `backend_busy`,
 * `deadline` or `memory_limit`. Never source, stack traces or stderr.
 */
export const FIELD_ERROR_CODE = /^[a-z][a-z_]{0,63}$/;

/** Thrown by an invoke port only with proof the resolver never ran. */
export class FieldNotExecuted extends Error {
  /** Becomes extensions.code when it matches FIELD_ERROR_CODE. */
  readonly code?: string;
  /** Becomes extensions.detail for the page owner only (bounded: one line, 200 characters). */
  readonly detail?: string;
  constructor(message = "not executed", code?: string, detail?: string) {
    super(message);
    this.name = "FieldNotExecuted";
    if (code !== undefined) this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/** Thrown by an invoke port when the resolver may have run and failed: outcome "unknown". */
export class FieldFailed extends Error {
  /** Becomes extensions.code when it matches FIELD_ERROR_CODE. */
  readonly code: string;
  /** What the backend said, e.g. the thrown error's message: extensions.detail for the page owner only. */
  readonly detail?: string;
  constructor(code: string, detail?: string) {
    super(code);
    this.name = "FieldFailed";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export interface RemoteRequest {
  query: string;
  variables?: AfJsonObject;
  operationName?: string;
}
export interface RemoteError {
  message: string;
  /** Response path, e.g. ["billing", "pay"]. */
  path?: (string | number)[];
  /**
   * For a backend field that failed: why, e.g. { code: "deadline" } (see
   * FIELD_ERROR_CODE). When the caller owns the page, `detail` adds what the
   * backend said (the thrown error's first line, at most 200 characters);
   * everyone else gets the code alone.
   */
  extensions?: { code: string; detail?: string };
}
export interface RemoteResponse {
  data: AfJsonObject | null;
  errors?: RemoteError[];
  /**
   * For a mutation: one entry per selected backend field, keyed by response
   * path joined with ".", e.g. { "billing.pay": "committed" }.
   */
  extensions?: { outcomes: Record<string, Outcome> };
}

export interface PageSchema {
  /** The composed SDL, for display and validation. */
  sdl: string;
  namespaces: readonly string[];
}

export interface ExecuteOptions {
  schema: PageSchema;
  request: RemoteRequest;
  caller: PageCaller;
  invoke(call: FieldCall): Promise<AfJson>;
  signal?: AbortSignal;
}

/** Shape of src/graphql/af-namespaces.ts. */
export interface NamespaceModule {
  /** Throws Error naming the namespace for duplicate/invalid names or an invalid file schema. */
  composePageSchema(sources: readonly NamespaceSource[]): PageSchema;
  /**
   * Validate and run one request. Rules:
   * - Selections outside the schema fail validation: data null, nothing invoked.
   * - `@auth` is checked before invoke: signedIn needs a subject; role needs
   *   caller.role >= the given role (VIEWER < EDITOR < OWNER). A field
   *   without @auth only needs the caller to be able to open the page.
   *   A refused field is null with an error and outcome "rejected".
   * - Mutation fields run one at a time in the order written, across and
   *   within namespaces: a field's invoke starts only after the previous
   *   field settled. A failed field does not stop later fields.
   * - Outcome per mutation field: invoke resolved → "committed";
   *   FieldNotExecuted or @auth refusal → "rejected"; any other
   *   throw → "unknown" (it ran and may have changed something).
   * - A failed invoke's error keeps its fixed message ("Backend request
   *   rejected before execution" / "Backend execution failed") and carries
   *   the FieldNotExecuted/FieldFailed `code` as `extensions.code`, plus its
   *   `detail` as `extensions.detail` when caller.role is OWNER and only then.
   * - Returned JSON is shaped by the selection and checked against the
   *   field's type; a mismatch is an error for that field.
   */
  executePageOperation(options: ExecuteOptions): Promise<RemoteResponse>;
}
