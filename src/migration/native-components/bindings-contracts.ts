import type {NativeCellAdapter} from './cell-contracts.ts';
import type { NativeJson, NativeTypedAnalysis } from "./analyze-contracts.ts";
export interface NativeBindingQuery {
  name: string;
  document: string;
  namespace: string;
  values: readonly { name: string; type: string }[];
  tableName: string;
  responsePath: readonly string[];
  decode: "registered-page-table-cells-v1";
}
/** Supplied by a registered operation owner; author output never contains SQL. */
export interface NativeRegisteredBindingMutation {
  mode?: "registered";
  name: string;
  document: string;
  namespace: string;
  values: readonly { name: string; type: string; nullable?: boolean; source?: {kind: "row"; field: string} }[];
  /** Registered operation outcome object; only outcome=committed may reset. */
  outcomePath: readonly string[];
  reset: readonly string[];
}
/** A saved historical action has no wire operation and no write backend. */
export interface NativeReadonlyBindingMutation {
  name: string;
  mode: "historical-readonly";
}
export type NativeBindingMutation = NativeRegisteredBindingMutation | NativeReadonlyBindingMutation;
/** Actual native control event ABI; derived from retained assignable scalar binding. */
export interface NativeControlWriteback {
  event: "af-change" | "input" | "change";
  source: "detail.value" | "target.value" | "target.checked";
  valueName: string;
  scalarType: string;
  multiple: boolean;
}
export interface NativeBindingIdentity {
  sourceNode: string;
  afId: string;
  sourceStart?: number;
  sourceEnd?: number;
  sourceSha256?: string;
  analysisSha256?: string;
  proofSha256?: string;
}
export type NativeBindingTarget = NativeBindingIdentity &
  (
    | { kind: "text" }
    | {kind:"cell";attribute:"data"}
    | {
        kind: "property";
        property: "disabled" | "value" | "checked" | "open" | "data";
        attribute: string;
      }
    | { kind: "condition"; templateId: string }
    | {
        kind: "loop";
        templateId: string;
        identity: {
          owner: string;
          /** null is the archived non-durable positional mode, never a guessed key. */
          keyBy: string | null;
          templateIds: readonly string[];
          domIds?: readonly { domId: string; templateAfId: string }[];
          encoding: "archived-instance-v1";
        };
      }
    | { kind: "action" }
  );
/** Explicit request-authoritative target identity. Source identity equivalence belongs to migration mappings. */
export interface NativeBindingViewer {
  namespace: string;
  identity: "target-subject-v1";
  document: string;
  responsePath: readonly [string, "viewer", "id"];
}
export interface NativeBindingsInput {
  cellAdapter?:NativeCellAdapter;
  viewer?: NativeBindingViewer;
  analysis: NativeTypedAnalysis;
  targets: readonly NativeBindingTarget[];
  queries: readonly NativeBindingQuery[];
  mutations: readonly NativeBindingMutation[];
}
export interface NativeBindingBlocker {
  sourceNode: string;
  code: string;
}
export type NativeBindingsResult =
  | {
      status: "complete";
      authorJs: string;
      localDefaults: Readonly<Record<string, NativeJson>>;
      blockers: readonly [];
    }
  | {
      status: "blocked";
      authorJs: null;
      localDefaults: null;
      blockers: readonly NativeBindingBlocker[];
    };
