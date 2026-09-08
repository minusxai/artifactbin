/**
 * Static-JSX-as-data: shared types for the isomorphic parse → validate → render
 * pipeline (File Architecture v2). A file's `jsx` field is a STATIC JSX document —
 * no functions, expressions, or handlers — that we parse to this normalized AST,
 * validate against an allowlist, and render via our own component map. It is data,
 * never executed.
 */

/** Any value expressible as JSON (what a static attribute / expression may hold). */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * The resolved value of an attribute or an expression child. `static: true` carries
 * a JSON literal; `static: false` records a non-static expression (a call, identifier,
 * arithmetic, spread, …) so the validator can reject it with a precise message.
 */
export type StaticValue =
  | { static: true; json: JsonValue }
  | { static: false; exprType: string; source: string };

export interface JsxAttribute {
  name: string;
  value: StaticValue;
  start: number;
  end: number;
}

/** An element: `<div …>`, `<Question …>`. `isComponent` ⇔ tag starts uppercase. */
export interface JsxElement {
  type: 'element';
  tag: string;
  isComponent: boolean;
  attributes: JsxAttribute[];
  children: JsxNode[];
  selfClosing: boolean;
  start: number;
  end: number;
}

/** Raw text content (e.g. a `<Question>`'s SQL, or story prose). */
export interface JsxText {
  type: 'text';
  value: string;
  start: number;
  end: number;
}

/** A `{…}` expression used as a child. Static literals are allowed; anything else is rejected. */
export interface JsxExpression {
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

export interface ValidationError {
  message: string;
  /** Offset into the original `jsx` source, when known. */
  start?: number;
  end?: number;
  tag?: string;
  attr?: string;
  /**
   * The source AROUND the fault, with `▶` marking the character — so a caller
   * holding the document in a shell heredoc can find the spot without counting
   * to a column number, and without re-sending to discover whether it guessed
   * right.
   */
  snippet?: string;
}

export interface ValidateOptions {
  /** Registered component names (Capitalized tags) that are renderable. */
  components: Iterable<string>;
  /**
   * Lowercase HTML tags to allow. Omit to allow all HTML tags except the built-in
   * dangerous denylist (`script`, `iframe`, …). Provide a set to restrict further.
   */
  allowedHtmlTags?: Iterable<string>;
  /**
   * Authoring policy for static JSX. `no-inline-style` allows authored `<style>` BLOCKS
   * (custom CSS attached to classes — sanitized at save by banned-css) but rejects
   * inline style props while leaving the general interpreter capable of rendering grandfathered
   * stored content.
   */
  stylePolicy?: 'allow' | 'no-inline-style';
}
