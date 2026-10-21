/** Only source and resolved package texts enter the network-free compile sandbox. */
export interface CompileRequest {
  readonly kind: "compile";
  readonly source: string;
  readonly packages: Readonly<Record<string, string>>;
  readonly modules: Readonly<
    Record<string, { readonly url: string; readonly code: string }>
  >;
}
/** Compiler-owned projection after validating the sandbox's untrusted reply. */
export interface CompileResult {
  readonly bundle: string;
  readonly metadata: {
    readonly typeDefs: string;
    readonly fields: string[];
    readonly roots: { readonly Query: string[]; readonly Mutation: string[] };
  };
  readonly runtime: string;
}
/** A process reply is untrusted even when the request is typed. */
export type SandboxCompilePort = (
  request: CompileRequest,
  signal?: AbortSignal,
) => Promise<unknown>;
