import type {NativeComponentRecipe,NativeStoryColumn} from './component-presentation-contracts.ts';
import type {NativeCellAdapter} from './cell-contracts.ts';
import type {NativeReaderTemplateReceipt} from './reader-template-contracts.ts';
import type { NativeAuthorProgramReceipt } from './author-program-contracts.ts';
import type {NativeChartMapping,NativeChartAdapter} from './chart-contracts.ts';
import type { NativeTypedAnalysis } from './analyze-contracts.ts';
import type { NativeIdentityRevision } from './identity-contracts.ts';
import type { NativeBindingQuery, NativeBindingMutation, NativeBindingTarget, NativeBindingViewer } from './bindings-contracts.ts';
import type { NativeOperationCoverage } from './operations-contracts.ts';
export interface NativeAssemblyStyle {
 storyColumn?:NativeStoryColumn;
 /** Exact source CSS bytes, including the recovered theme and authored utility closure. */
 rootSha256?: string;
 htmlAttributes?: Readonly<Record<string,string>>;
 storyWrapper?: {tag:'div';attributes:Readonly<Record<string,string>>};
 css: string;
 sha256: string;
 sourceSha256: string;
}
/** Trusted retained renderer output, bound to exact analysis and each original node. */
export interface NativeAssemblyPresentation {
 componentRecipes?:readonly (NativeComponentRecipe & {nodeSha256:string})[];
 sourceSha256:string; analysisSha256:string; compilerSha256:string;
 inlineStyles:readonly {sourceNode:string;nodeSha256:string;css:string}[];
 resourcePatches:readonly {sourceNode:string;nodeSha256:string;attributes:Readonly<Record<string,string>>}[];
 sha256:string;
}
export interface NativeAssemblyBackend {
 namespace: string;
 url: string;
 /** Binds the descriptor list to a separately registered operation admission. */
 descriptorsSha256: string;
 planSha256: string;
 operations: readonly {kind:'query'|'mutation';name:string;operationSha256:string}[];
}
export interface NativeAssemblyModule {name:string;register:string;specifier:string;sha256:string}
export interface NativeAssemblyFile {path:string;bytes:Uint8Array;sha256:string}
export interface NativeAssemblyInput {
 navigation?:import("./resource-navigation-contracts.ts").NativeNavigationPolicy;
 people?:import("./person-contracts.ts").NativeBindingPeople;
 authDelegations?:readonly import("./person-contracts.ts").NativeAuthDelegation[];
 cellAdapter?:NativeCellAdapter;
 viewer?: NativeBindingViewer;
 readerTemplate?:NativeReaderTemplateReceipt;
 markdown?:readonly import("./markdown-contracts.ts").NativeMarkdownReceipt[];
 authorPrograms?: readonly NativeAuthorProgramReceipt[];
 chartMappings?:readonly NativeChartMapping[];
 chartAdapter?:NativeChartAdapter;
 modules?: readonly NativeAssemblyModule[];
 files?: readonly NativeAssemblyFile[];
 analysis: NativeTypedAnalysis;
 identity: NativeIdentityRevision;
 targetRevision: string;
 coreUrl: string;
 style?: NativeAssemblyStyle;
 presentation?: NativeAssemblyPresentation;
 urls?: readonly {source:string;target:string;sha256:string}[];
 formattedValues?: readonly {sourceNode:string;analysisSha256:string;formatterSha256:string;text:string}[];
 
 operationCoverage?: NativeOperationCoverage;
 backends: readonly NativeAssemblyBackend[];
 queries: readonly NativeBindingQuery[];
 mutations: readonly NativeBindingMutation[];
}
export interface NativeAssemblyBlocker { sourceNode: string; code: string }
export type NativeAssemblyResult = {
 status: 'complete'; files: readonly NativeAssemblyFile[]; html: string; htmlSha256: string; bindingTargets: readonly NativeBindingTarget[]; blockers: readonly [];
} | {
 status: 'blocked'; html: null; bindingTargets: readonly NativeBindingTarget[]; blockers: readonly NativeAssemblyBlocker[];
};
