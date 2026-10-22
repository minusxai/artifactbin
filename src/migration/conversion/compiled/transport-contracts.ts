import type { PreparedMermaidPlan } from "./mermaid-contracts.ts";
/** Only the caller's final trusted esbuild invocation may supply this map. */
export interface CompiledTransportInput {
  readonly javascript: string;
  readonly sourceMap?: string;
  readonly mermaid?: {
    readonly entry: { readonly name: string; readonly source: string };
    readonly runtime: { readonly name: string; readonly source: string };
    readonly plans: readonly PreparedMermaidPlan[];
  };
}
export type ValidateCompiledTransport = (input: CompiledTransportInput) => void;
