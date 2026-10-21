export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
/** Supplied by the authenticated gateway, never deserialized from request JSON. */
export interface Principal {
  readonly tenant: string;
  readonly subject: string;
}
export interface Invocation {
  version: string;
  field: string;
  args: Json;
}
export interface Limits {
  deadlineMs: number;
  inputBytes: number;
  outputBytes: number;
  rssKillMiB: number;
}
export interface Capabilities {
  invoke(request: Json): Promise<Json>;
}
/** One immutable backend bundle includes schema metadata and resolver implementation. */
export interface Backend {
  typeDefs: string;
  schema: Record<string, string>;
  resolve(
    field: string,
    args: Json,
    context: Principal,
    capabilities: Capabilities,
  ): Promise<Json> | Json;
}
export interface Host {
  schemaOf(principal: Principal, version: string): string;
  deploy(principal: Principal, version: string, source: string): Promise<void>;
  invoke(
    principal: Principal,
    input: Invocation,
    signal?: AbortSignal,
  ): Promise<Json>;
}

export type CapabilityHandler = (
  principal: Principal,
  request: Json,
  signal: AbortSignal,
) => Promise<Json>;
