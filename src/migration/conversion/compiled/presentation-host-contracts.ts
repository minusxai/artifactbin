/** Structural subset of the frozen archived parser AST; no authored code is evaluated. */
export interface ArchivedPresentationAttribute {
  readonly name: string;
  readonly value: {
    readonly static: boolean;
    readonly json?: unknown;
    readonly [key: string]: unknown;
  };
  readonly start: number;
  readonly end: number;
}
export interface ArchivedPresentationNode {
  readonly type: string;
  readonly tag?: string;
  readonly attributes?: readonly ArchivedPresentationAttribute[];
  readonly children?: readonly ArchivedPresentationNode[];
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}
