/**
 * Static-JSX-as-data: shared types for the isomorphic parse → validate → render
 * pipeline. Markup is parsed to a normalized AST, validated against an allowlist,
 * and rendered via our component map. JSON literals and allowlisted reactive
 * expressions are data interpreted by the runtime; arbitrary JavaScript,
 * functions and event handlers are not allowed.
 */
import type { ReactiveExpression } from './reactive';

/** Any value expressible as JSON (what a static attribute / expression may hold). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * The resolved value of an attribute or an expression child. `static: true` carries
 * a JSON literal; `static: false` records a non-static expression (a call, identifier,
 * arithmetic, spread, …). The validator accepts only supported reactive or row
 * expressions in their permitted scopes and rejects the rest with source spans.
 */
export type StaticValue =
  | { static: true; json: JsonValue }
  | { static: false; exprType: string; source: string; reactive?: ReactiveExpression };

export interface JsxAttribute {
  name: string;
  value: StaticValue;
  start: number;
  end: number;
}

/** An element: `<div …>`, `<Chart …>`. `isComponent` ⇔ tag starts uppercase. */
export interface JsxElement {
  /** Parser-owned structural nodes. Never emitted as tags or given source IDs. */
  control?: {kind: 'fragment'} | {kind: 'and' | 'conditional'; test: ReactiveExpression};
  type: 'element';
  /** The canonical name: an earlier name the source used (`Question`, `Number`) is already its new one (component-names COMPONENT_ALIASES). */
  tag: string;
  /**
   * The earlier name the source spelled this element with, present only when it differs from `tag`. Only code that
   * writes source back reads it, so an edit keeps the author's spelling; everything else dispatches on `tag`.
   */
  authoredTag?: string;
  isComponent: boolean;
  attributes: JsxAttribute[];
  children: JsxNode[];
  selfClosing: boolean;
  start: number;
  end: number;
}

/** Raw text content (e.g. a `<Query>`'s SQL, or story prose). */
export interface JsxText {
  type: 'text';
  value: string;
  start: number;
  end: number;
}

/** A `{…}` child: a static literal or an allowlisted reactive/row expression in a valid scope. */
interface JsxExpression {
  type: 'expression';
  value: StaticValue;
  source: string;
  start: number;
  end: number;
}

export type JsxNode = JsxElement | JsxText | JsxExpression;

/** Result of {@link parseJsx}: a list of root nodes, or a syntax error. */
export type ParseResult =
  | { ok: true; nodes: JsxNode[] }
  /**
   * `pos` is the offset in the CALLER's source (the `<>…</>` wrapper is
   * subtracted), so an error can be pointed at rather than described. Absent
   * when the failure carried no position at all.
   */
  | { ok: false; error: string; pos?: number };
