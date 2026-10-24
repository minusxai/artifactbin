import type { NativeGraphAnalysis, NativeSelectedRevision } from './contracts.ts';
export type NativeJson = null | boolean | number | string | NativeJson[] | { [key: string]: NativeJson };
export type RetainedStaticValue = { static: true; json: NativeJson } | { static: false; exprType: string; source: string; reactive?: NativeJson };
interface RetainedSpan { start: number; end: number }
export interface RetainedAttribute extends RetainedSpan { name: string; value: RetainedStaticValue }
/** Serialized retained JsxNode contract; graphKey is attached by retained graphNodes, never inferred. */
export type RetainedJsxNode = RetainedSpan & { graphKey: string } & (
 | { type: 'element'; tag: string; authoredTag?: string; isComponent: boolean; attributes: RetainedAttribute[]; children: RetainedJsxNode[]; selfClosing: boolean; control?: NativeJson }
 | { type: 'text'; value: string }
 | { type: 'expression'; value: RetainedStaticValue; source: string }
);
export interface RetainedDeclaration extends RetainedSpan { name: string; [key: string]: NativeJson }
export interface RetainedDataflow {
 imports: RetainedDeclaration[]; values: RetainedDeclaration[];
 queries: RetainedDeclaration[]; mutations: RetainedDeclaration[];
 notifications?: RetainedDeclaration[];
}
export interface RetainedCompilerSnapshot { nodes: RetainedJsxNode[]; flow: RetainedDataflow }
export interface NativeTypedAnalysis extends RetainedCompilerSnapshot {
 key: NativeGraphAnalysis['key'];
 documentSha256: string; sourceSha256: string; analysisSha256: string;
 compilerSourceSha256: string;
 /** Exact recovered-source spans, separate from potentially old parser spans retained in AST. */
 sourceSpans: Array<{ sourceNode: string; sourceStart: number; sourceEnd: number }>;
}
export interface NativeAnalyzeOptions {
 legacyRoot: string;
 /** Must match actual files before AND after the offline compiler subprocess. */
 compilerSourceSha256: string;
}
/** Injected pure port permits behavior tests; production implementation uses only the retained offline subprocess. */
export interface NativeTypedCompilerPort {
 fingerprint(): Promise<string>;
 extract(document: unknown): Promise<RetainedCompilerSnapshot>;
}
export type AnalyzeNativeTypedRevision = (revision: NativeSelectedRevision, analysis: NativeGraphAnalysis, options: NativeAnalyzeOptions) => Promise<NativeTypedAnalysis>;
