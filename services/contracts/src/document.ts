/** Canonical document data. Parser positions and editor engine state are never persisted. */
export type DocumentJson = null | boolean | number | string | DocumentJson[] | {[key: string]: DocumentJson};
export interface DocumentMark {type: string; attrs?: Record<string, DocumentJson>}
export type DocumentInline = {type: 'text'; text: string; marks: DocumentMark[]} | {type: 'break'; marks?: DocumentMark[]} | {type: 'nodeRef'; nodeId: string};
export interface DocumentNode {
  type: string;
  name?: string;
  tag?: string;
  props: Record<string, DocumentJson>;
  children?: string[];
  slots?: Record<string, string[]>;
  content?: DocumentInline[];
  text?: string;
  bindings?: Record<string, {source: string; scope: 'reactive' | 'row'}>;
  sourceAst?: DocumentJson;
}
export interface RichDocument {schemaVersion: 1; rootId: string; nodes: Record<string, DocumentNode>}
/** Paths are relative to a node. Offsets are Unicode code points, not UTF-16 units. */
export type DocumentPrimitive =
  | {kind: 'set'; nodeId: string; path: string[]; value: DocumentJson}
  | {kind: 'unset'; nodeId: string; path: string[]}
  | {kind: 'text'; nodeId: string; path: string[]; start: number; deleteCount: number; text: string}
  | {kind: 'insert'; nodeId: string; path: string[]; index: number; value: DocumentJson}
  | {kind: 'remove'; nodeId: string; path: string[]; index: number}
  | {kind: 'addNodes'; nodes: Record<string, DocumentNode>}
  | {kind: 'removeNodes'; ids: string[]};
export interface DocumentEdit {
  baseVersion: number;
  operationId: string;
  changedIds: string[];
  ancestorIds: string[];
  operations: DocumentPrimitive[];
}
export interface DocumentSnapshot {id: string; version: number; document: RichDocument}
export type DocumentEditResult =
  | {updated: true; version: number; document: RichDocument}
  | {updated: false; reason: 'conflict' | 'invalid' | 'duplicate' | 'not_found'; version?: number; document?: RichDocument; detail?: string};
