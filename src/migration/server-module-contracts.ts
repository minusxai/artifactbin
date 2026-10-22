/** Names derived from the pinned canonical document, never runtime caller input. */
export interface LegacyServerDeclarations {
  readonly values: readonly string[];
  readonly queries: readonly string[];
  readonly mutations: readonly string[];
}
export interface CompiledLegacyServerModule {
  /** Server-only factory expression: (invocationBindings) => original default handler. */
  readonly factorySource: string;
  readonly sourceSha256: string;
  readonly references: LegacyServerDeclarations;
}
/** Offline compilation only; the authored module is evaluated exclusively inside its backend isolate. */
export type CompileLegacyServerModule = (
  source: string,
  declarations: LegacyServerDeclarations,
) => Promise<CompiledLegacyServerModule>;
