/**
 * THE SCRIPT MIGRATION: a document written for the retired script contracts, rewritten for the Solid one
 * (lib/author-script/author-module.server, run by lib/islands/page-runtime). `scripts/migrate-scripts.mjs` is its
 * command line; this module is pure text in, text out, and runs no author code.
 *
 * What it rewrites:
 *  - `import { region, monthly, bump } from 'page'` (the declared names themselves) → `signal('$region')`,
 *    `query('$monthly')`, `mutation('$bump')` bindings, by the kind the Helmet declares;
 *  - on those bindings, `x.value` → `x()`, `x.value = v` → `setX(v)` (compound and `++` too), `x.loading.value` →
 *    `x.loading()`, `x.error.value` → `x.error()`, `x.peek()` → `untrack(x)`;
 *  - `effect`, `computed`, `batch`, `signal`, `untracked` from '@preact/signals' → `createEffect`, `createMemo`,
 *    `batch`, `createSignal`, `untrack` from 'solid-js' (a local signal becomes Solid's pair, its `.value` the same way);
 *  - the `mx` bridge: `mx.set({...})` → setters, `mx.mutate('name', args)` → a `mutation('$name')` binding,
 *    `mx.read([...])` / `mx.subscribe([...], fn)` → a small adapter that hands the old snapshot shape over the bindings;
 *    a setter returns no promise, so a `.then`/`.catch`/`.finally` chain on `mx.set` is dropped (a `.catch` never ran:
 *    a handler with a body leaves a `/* migrated: … *\/` comment), unless a `.then`/`.finally` handler does something,
 *    when the chain is kept over `Promise.resolve(…)`; a mutation is async, so a chain on it stays;
 *  - a managed `<Iframe>` of static HTML, `<style>` and `<script>` → its children inlined into the body (in a `<div>`
 *    keeping the Iframe's id), its style scoped to that div in the Helmet style (its `height` a min-height there: a body
 *    element takes no inline style), its script merged into the Helmet script in a block of its own, marked
 *    `{/* migrated from Iframe *\/}`; the frame's `<title>` was its tab title and is dropped. A frame with no script
 *    adds no script. Its script's `document.querySelector`/`querySelectorAll`/`getElementsBy{ClassName,TagName}` and
 *    `document.body` saw the frame's document: they are scoped to the frame's `<div>` (`document.getElementById(id)`),
 *    as its CSS's `body`, `html` and `:root` are (`body.ready` → `#id.ready`, `html.wide body` → `#id.wide`).
 *
 * Anything else it leaves as it is, with a `MIGRATE:` comment where it stands (`/* … *\/` in the script, `{/* … *\/}`
 * in markup), and reports. It is a fixpoint: a migrated document, or one already on the Solid contract, comes back
 * byte for byte.
 */
import { parseSync, traverse, type NodePath, type types as t } from '@babel/core';
import { escapeHtml } from '@artifactbin/utils/escape';
import { parseJsx } from '@/lib/jsx/parse';
import type { JsxElement, JsxNode } from '@/lib/jsx/types';
import { splitHelmet, type HelmetContent } from '@/lib/document/helmet';

export interface DocumentMigration {
  source: string;
  changed: boolean;
  /** The rules that rewrote something, in words. */
  applied: string[];
  /** What was left for a person, each also marked `MIGRATE:` in the document (except a parse failure). */
  unresolved: string[];
}

type Kind = 'value' | 'query' | 'mutation';
interface Binding { name: string; kind: Kind; local: string; setter?: string }
interface Edit { start: number; end: number; text: string }

const PAGE_BINDERS = ['signal', 'query', 'mutation'] as const;
const PREACT_TO_SOLID: Readonly<Record<string, string>> = { effect: 'createEffect', computed: 'createMemo', batch: 'batch', signal: 'createSignal', untracked: 'untrack' };
const COMPONENT_LIBRARIES = new Set(['preact', 'preact/hooks', 'preact/compat', 'react', 'react-dom', 'react-dom/client']);
const MX_METHODS = new Set(['read', 'set', 'subscribe', 'mutate', 'describe']);
const IFRAME_NOTE = 'migrated from Iframe';
/** Lookups on a frame's `document` that an element answers the same way, scoped to the inlined frame's root. */
const FRAME_LOOKUPS = new Set(['querySelector', 'querySelectorAll', 'getElementsByClassName', 'getElementsByTagName']);
const PROMISE_METHODS = new Set(['then', 'catch', 'finally']);
const SET_IS_SYNC = '/* migrated: set is synchronous; its .catch handler was dropped */';

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);
const escapeTemplate = (text: string): string => text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const lineOf = (code: string, offset: number): number => code.slice(0, offset).split('\n').length;
/** A single-quoted JavaScript string literal. */
const jsString = (text: string): string => `'${JSON.stringify(text).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
/** A promise handler that does nothing: absent, or a function with an empty body or one returning nothing. */
const isNoopHandler = (node: t.Node | undefined): boolean => {
  if (!node) return true;
  if (node.type !== 'ArrowFunctionExpression' && node.type !== 'FunctionExpression') return false;
  const body = node.body;
  if (body.type === 'BlockStatement') return !body.body.length;
  return body.type === 'NullLiteral' || (body.type === 'Identifier' && body.name === 'undefined')
    || (body.type === 'UnaryExpression' && body.operator === 'void' && body.argument.type === 'NumericLiteral');
};

/** Apply non-overlapping edits (an insertion may share a start with a replacement: it lands before it). */
function applyEdits(text: string, edits: Edit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || (b.end - b.start) - (a.end - a.start));
  let out = text;
  let floor = Infinity;
  for (const edit of sorted) {
    if (edit.end > floor) throw new Error(`overlapping rewrites at ${edit.start}`);
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    floor = edit.start;
  }
  return out;
}

/** The kinds the Helmet declares, as the page runtime binds them. */
function declaredKinds(content: HelmetContent): Map<string, Kind> {
  const kinds = new Map<string, Kind>();
  for (const v of content.values) kinds.set(v.name, v.kind === 'scalar' && (v.type as string) !== 'table' ? 'value' : 'query');
  for (const q of content.queries) kinds.set(q.name, 'query');
  for (const m of content.mutations) kinds.set(m.name, 'mutation');
  return kinds;
}

function parseScript(code: string): t.File | null {
  try {
    return parseSync(code, { configFile: false, babelrc: false, sourceType: 'module', parserOpts: { plugins: ['jsx'], allowReturnOutsideFunction: true } }) as t.File | null;
  } catch {
    return null;
  }
}

/**
 * The names a generated binding must avoid. `top`: what the script binds at its top level, and the globals it reads —
 * an accessor, read only by top-level code we write, may be shadowed further in. `all`: every name bound in any scope
 * too — a setter or a mutation is called from inside the author's functions, where a shadow would catch it.
 */
interface Names { top: Set<string>; all: Set<string> }
function namesOf(ast: t.File, into: Names): void {
  traverse(ast, {
    Scopable(path) {
      for (const name of Object.keys(path.scope.bindings)) { into.all.add(name); if (path.scope === path.scope.getProgramParent()) into.top.add(name); }
    },
    Identifier(path) {
      if (path.isReferencedIdentifier() && !path.scope.hasBinding(path.node.name)) { into.top.add(path.node.name); into.all.add(path.node.name); }
    },
  });
}

/** The shared state of one document's migration: its bindings, imports and adapter, built across every script piece. */
class Registry {
  readonly bindings = new Map<string, Binding>();
  readonly solid = new Set<string>();
  readonly binders = new Set<string>();
  readonly adapter = new Set<string>();
  readonly applied = new Set<string>();
  readonly unresolved: string[] = [];
  constructor(readonly kinds: Map<string, Kind>, readonly taken: Names) {}

  /** A name no script uses: at its top level only (`strict` false, an accessor), or in any scope. */
  fresh(base: string, strict = true): string {
    const avoid = strict ? this.taken.all : this.taken.top;
    let name = base;
    for (let i = 2; avoid.has(name); i++) name = `${base}${i}`;
    this.taken.top.add(name);
    this.taken.all.add(name);
    return name;
  }
  /** The binding of a declared name: the author's local name when a page import gave one, else a fresh one. */
  bind(name: string, local?: string): Binding | null {
    const kind = this.kinds.get(name);
    if (!kind) return null;
    const known = this.bindings.get(name);
    if (known) return known;
    const chosen = local ?? this.fresh(name, kind === 'mutation');
    const binding: Binding = { name, kind, local: chosen, ...(kind === 'value' ? { setter: this.fresh(`set${capitalize(chosen)}`) } : {}) };
    this.bindings.set(name, binding);
    this.binders.add(kind === 'value' ? 'signal' : kind);
    return binding;
  }
  note(message: string): void { if (!this.unresolved.includes(message)) this.unresolved.push(message); }
}

interface Piece {
  code: string;
  ast: t.File;
  /** An Iframe's classic script: wrapped in a block, its imports hoisted. */
  framed: boolean;
  /** The id of the `<div>` an Iframe's script was inlined with: its document lookups are scoped to it. */
  root?: string;
}

interface PieceResult { code: string; changed: boolean; imports: string[] }

/** `/* MIGRATE: … *\/` before `pos`, unless that very note already stands there (a second run adds nothing). */
function noteEdit(code: string, pos: number, message: string): Edit | null {
  const comment = `/* MIGRATE: ${message} */ `;
  const run = /(?:\/\* MIGRATE: (?:(?!\*\/)[\s\S])*\*\/ )+$/.exec(code.slice(0, pos))?.[0] ?? '';
  return run.includes(comment) ? null : { start: pos, end: pos, text: comment };
}

/** Does this script speak a retired contract (an old `page` import, Preact signals or components, the `mx` bridge)? */
function isLegacy(ast: t.File): boolean {
  let legacy = false;
  traverse(ast, {
    ImportDeclaration(path) {
      const from = path.node.source.value;
      if (from === '@preact/signals' || from === '@preact/signals-core' || from.startsWith('preact')) legacy = true;
      if (from === 'page' && path.node.specifiers.some((s) => s.type !== 'ImportSpecifier' || !(PAGE_BINDERS as readonly string[]).includes(keyName(s.imported) ?? ''))) legacy = true;
      if (legacy) path.stop();
    },
    MemberExpression(path) {
      if (isMx(path.node.object, path)) { legacy = true; path.stop(); }
    },
  });
  return legacy;
}

/** Is `path` the global `mx` (or `window.mx`)? */
function isMx(node: t.Node, path: NodePath): boolean {
  if (node.type === 'Identifier') return node.name === 'mx' && !path.scope.hasBinding('mx');
  return node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' && node.object.name === 'window'
    && node.property.type === 'Identifier' && node.property.name === 'mx';
}

const keyName = (key: t.Node): string | null =>
  key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : null;

/** Rewrite one script piece; edits only, so the author's formatting survives. */
function migratePiece(piece: Piece, registry: Registry): PieceResult {
  const { code, ast } = piece;
  if (!piece.framed && !isLegacy(ast)) return { code, changed: false, imports: [] };
  let edits: Edit[] = [];
  const imports: string[] = [];
  /** Notes, reported once the code they stand in is known to survive (a dropped promise chain takes its own). */
  const notes: Array<{ pos: number; message: string }> = [];
  const note = (pos: number, message: string) => {
    notes.push({ pos, message });
    const edit = noteEdit(code, pos, message);
    if (edit) edits.push(edit);
  };
  /** Code an edit removes whole (`[start, end)`), with that edit: nothing else may rewrite inside it. */
  const dropped: Array<{ start: number; end: number; by: Edit }> = [];
  /** Remove a whole statement with the line break and indentation after it. */
  const removeStatement = (node: t.Node) => {
    let end = node.end!;
    const rest = /^[ \t]*\n[ \t]*/.exec(code.slice(end));
    if (rest) end += rest[0].length;
    edits.push({ start: node.start!, end, text: '' });
  };
  /** Bindings whose `.value` is an accessor read (and, with a setter, a write), by the Babel binding (shadowing-safe). */
  type Accessor = { setter?: string; kind: 'value' | 'query' | 'memo' };
  const accessors = new Map<object, Accessor>();
  const track = (path: NodePath, name: string, accessor: Accessor) => { const b = path.scope.getBinding(name); if (b) accessors.set(b, accessor); };

  const statementOf = (path: NodePath): NodePath => path.getStatementParent() ?? path;

  traverse(ast, {
    ImportDeclaration(path) {
      const from = path.node.source.value;
      if (from === 'page') {
        const specifiers = path.node.specifiers;
        const old = specifiers.filter((s) => s.type !== 'ImportSpecifier' || !(PAGE_BINDERS as readonly string[]).includes(keyName(s.imported) ?? ''));
        if (!old.length) return; // the Solid contract already
        let ok = true;
        for (const s of old) {
          const name = s.type === 'ImportSpecifier' ? keyName(s.imported) : null;
          const binding = name ? registry.bind(name, s.local.name) : null;
          if (!binding) { ok = false; note(path.node.start!, `\`${s.local.name}\` imported from 'page' is not a name the Helmet declares`); continue; }
          if (binding.local !== s.local.name) { ok = false; note(path.node.start!, `\`${s.local.name}\` and \`${binding.local}\` both bind $${name}; keep one`); continue; }
          if (binding.kind !== 'mutation') track(path, binding.local, { kind: binding.kind, ...(binding.setter ? { setter: binding.setter } : {}) });
        }
        if (!ok) return;
        for (const s of specifiers) if (s.type === 'ImportSpecifier' && (PAGE_BINDERS as readonly string[]).includes(keyName(s.imported) ?? '')) registry.binders.add(keyName(s.imported)!);
        removeStatement(path.node);
        registry.applied.add("`import { … } from 'page'` → `signal`, `query` and `mutation` bindings by declared kind");
        return;
      }
      if (from === '@preact/signals' || from === '@preact/signals-core') {
        for (const s of path.node.specifiers) {
          const imported = s.type === 'ImportSpecifier' ? keyName(s.imported) : null;
          const solid = imported ? PREACT_TO_SOLID[imported] : undefined;
          if (!solid) { note(path.node.start!, `\`${s.local.name}\` from '${from}' has no Solid equivalent here`); return; }
        }
        for (const s of path.node.specifiers) {
          const imported = keyName((s as t.ImportSpecifier).imported)!;
          const solid = PREACT_TO_SOLID[imported]!;
          const local = s.local.name;
          const binding = path.scope.getBinding(local);
          if (local === imported) {
            registry.solid.add(solid);
            for (const ref of binding?.referencePaths ?? []) if (solid !== local) edits.push({ start: ref.node.start!, end: ref.node.end!, text: solid });
          } else registry.solid.add(`${solid} as ${local}`);
          for (const ref of binding?.referencePaths ?? []) {
            const call = ref.parentPath;
            if (!call?.isCallExpression() || call.node.callee !== ref.node) continue;
            const declarator = call.parentPath;
            if (imported === 'computed' && declarator?.isVariableDeclarator() && declarator.node.id.type === 'Identifier') {
              track(declarator, declarator.node.id.name, { kind: 'memo' });
            } else if (imported === 'signal' && declarator?.isVariableDeclarator() && declarator.node.id.type === 'Identifier') {
              const name = declarator.node.id.name;
              const setter = registry.fresh(`set${capitalize(name)}`);
              track(declarator, name, { kind: 'value', setter });
              edits.push({ start: declarator.node.id.start!, end: declarator.node.id.end!, text: `[${name}, ${setter}]` });
            } else if (imported === 'effect' && !call.parentPath?.isExpressionStatement()) {
              note(statementOf(call).node.start!, '`createEffect` returns nothing; to stop it, create it inside `createRoot` and call its dispose');
            }
          }
        }
        removeStatement(path.node);
        registry.applied.add("`effect`/`computed`/`batch`/`signal` from '@preact/signals' → `createEffect`/`createMemo`/`batch`/`createSignal` from 'solid-js'");
        return;
      }
      if (COMPONENT_LIBRARIES.has(from)) note(path.node.start!, `'${from}' is Preact/React: port this component code to Solid by hand (props are getters, hooks become createSignal/createEffect)`);
      if (piece.framed) { imports.push(code.slice(path.node.start!, path.node.end!)); removeStatement(path.node); }
    },
  });

  // `.value` and friends, once every accessor local is known.
  traverse(ast, {
    Identifier(path) {
      const own = accessors.size ? path.scope.getBinding(path.node.name) : undefined;
      const accessor = own ? accessors.get(own) : undefined;
      if (!accessor || !path.isReferencedIdentifier()) return;
      const member = path.parentPath;
      const name = path.node.name;
      if (!member?.isMemberExpression() || member.node.object !== path.node || member.node.computed || member.node.property.type !== 'Identifier') {
        if (member?.isVariableDeclarator() || member?.isArrayPattern()) return; // its own declaration
        if (accessor.kind === 'value' || accessor.kind === 'memo') note(statementOf(path).node.start!, `\`${name}\` is used as a signal object; it is now an accessor (\`${name}()\`)${accessor.setter ? ` with \`${accessor.setter}\`` : ''}`);
        return;
      }
      const prop = member.node.property.name;
      const outer = member.parentPath;
      if (prop === 'value') {
        if (outer?.isAssignmentExpression() && outer.node.left === member.node) {
          if (!accessor.setter) { note(statementOf(path).node.start!, `\`${name}\` is read-only`); return; }
          const op = outer.node.operator;
          const right = outer.node.right;
          const head = op === '=' ? `${accessor.setter}(` : `${accessor.setter}(${name}() ${op.slice(0, -1)} (`;
          edits.push({ start: outer.node.start!, end: right.start!, text: head });
          edits.push({ start: right.end!, end: outer.node.end!, text: op === '=' ? ')' : '))' });
          return;
        }
        if (outer?.isUpdateExpression()) {
          if (!accessor.setter) { note(statementOf(path).node.start!, `\`${name}\` is read-only`); return; }
          edits.push({ start: outer.node.start!, end: outer.node.end!, text: `${accessor.setter}(${name}() ${outer.node.operator === '++' ? '+' : '-'} 1)` });
          return;
        }
        edits.push({ start: member.node.start!, end: member.node.end!, text: `${name}()` });
        return;
      }
      if ((prop === 'loading' || prop === 'error') && accessor.kind === 'query' && outer?.isMemberExpression() && !outer.node.computed
        && outer.node.property.type === 'Identifier' && outer.node.property.name === 'value') {
        edits.push({ start: outer.node.start!, end: outer.node.end!, text: `${name}.${prop}()` });
        return;
      }
      if (prop === 'peek' && outer?.isCallExpression() && outer.node.callee === member.node) {
        registry.solid.add('untrack');
        edits.push({ start: outer.node.start!, end: outer.node.end!, text: `untrack(${name})` });
        return;
      }
      if (prop === 'ready' && accessor.kind === 'query') return;
      note(statementOf(path).node.start!, `\`${name}.${prop}\` has no Solid equivalent; read \`${name}()\``);
    },
  });
  if (accessors.size) registry.applied.add('`x.value` reads and writes → `x()` and its setter; `.loading.value`/`.error.value` → `.loading()`/`.error()`');

  // The mx bridge.
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier' || !isMx(callee.object, path)) return;
      const method = callee.property.name;
      const args = path.node.arguments;
      const at = statementOf(path).node.start!;
      if (!MX_METHODS.has(method)) { note(at, `\`mx.${method}\` is not part of the bridge`); return; }
      if (method === 'describe') { note(at, '`mx.describe()` has no equivalent: the bindings are named where they are bound'); return; }
      if (method === 'set') {
        const patch = args[0];
        if (args.length !== 1 || patch?.type !== 'ObjectExpression' || !patch.properties.length) { note(at, '`mx.set` with a computed patch: call each Value\'s setter instead'); return; }
        const parts: Array<{ setter: string; value: t.Node }> = [];
        for (const property of patch.properties) {
          const key = property.type === 'ObjectProperty' && !property.computed ? keyName(property.key) : null;
          const binding = key ? registry.bind(key) : null;
          if (!binding || binding.kind !== 'value' || property.type !== 'ObjectProperty') { note(at, `\`mx.set\` writes ${key ? `\`${key}\`, which is not a declared scalar Value` : 'a computed key'}`); return; }
          parts.push({ setter: binding.setter!, value: property.value });
        }
        if (parts.length > 1) registry.solid.add('batch');
        // `mx.set(…).then(…).catch(…)`: the old bridge returned a promise, a setter does not.
        const chain: Array<{ method: string; args: t.CallExpression['arguments'] }> = [];
        let outer: NodePath = path;
        for (;;) {
          const member = outer.parentPath;
          const call = member?.parentPath;
          if (outer.node.extra?.parenthesized || !member?.isMemberExpression() || member.node.object !== outer.node || member.node.computed
            || member.node.property.type !== 'Identifier' || !PROMISE_METHODS.has(member.node.property.name)
            || !call?.isCallExpression() || call.node.callee !== member.node) break;
          chain.push({ method: member.node.property.name, args: call.node.arguments });
          outer = call;
        }
        // A `.then`/`.finally` handler that does something ran after the old set resolved: keep it, over a resolved promise.
        const live = chain.some((link) => link.method !== 'catch' && !isNoopHandler(link.args[0]));
        const deadCatch = chain.some((link) => (link.method === 'catch' && !isNoopHandler(link.args[0])) || (link.method === 'then' && !isNoopHandler(link.args[1])));
        const wrap = live ? 'Promise.resolve(' : '';
        parts.forEach((part, i) => {
          const before = i === 0 ? path.node.start! : parts[i - 1]!.value.end!;
          const opener = parts.length > 1 ? (i === 0 ? `${wrap}batch(() => { ${part.setter}(` : `); ${part.setter}(`) : `${wrap}${part.setter}(`;
          edits.push({ start: before, end: part.value.start!, text: opener });
        });
        const close = `${parts.length > 1 ? '); })' : ')'}${wrap ? ')' : ''}`;
        if (chain.length && !live) {
          const edit = { start: parts.at(-1)!.value.end!, end: outer.node.end!, text: `${close}${deadCatch ? ` ${SET_IS_SYNC}` : ''}` };
          edits.push(edit);
          dropped.push({ start: path.node.end!, end: outer.node.end!, by: edit });
        } else edits.push({ start: parts.at(-1)!.value.end!, end: path.node.end!, text: close });
        registry.applied.add('`mx.set({...})` → the Values\' setters');
        if (chain.length) registry.applied.add('`mx.set(…).then/.catch/.finally` → the setter called plainly (a setter returns no promise); a `.then`/`.finally` that does something kept over `Promise.resolve(…)`');
        return;
      }
      if (method === 'mutate') {
        const name = args[0]?.type === 'StringLiteral' ? args[0].value : null;
        const binding = name ? registry.bind(name) : null;
        if (!binding || binding.kind !== 'mutation') { note(at, `\`mx.mutate\` names ${name ? `\`${name}\`, which is not a declared Mutation` : 'a computed name'}`); return; }
        if (args.length > 1) {
          edits.push({ start: path.node.start!, end: args[1]!.start!, text: `${binding.local}(` });
          edits.push({ start: args.at(-1)!.end!, end: path.node.end!, text: ')' });
        } else edits.push({ start: path.node.start!, end: path.node.end!, text: `${binding.local}()` });
        registry.applied.add("`mx.mutate('name', args)` → a `mutation('$name')` binding, called");
        return;
      }
      // read / subscribe
      const list = args[0];
      const names = list?.type === 'ArrayExpression' && list.elements.every((e) => e?.type === 'StringLiteral')
        ? list.elements.map((e) => (e as t.StringLiteral).value) : null;
      if (!names) { note(at, `\`mx.${method}\` with a computed name list: list the names literally`); return; }
      for (const name of names) {
        const binding = registry.bind(name);
        if (!binding || binding.kind === 'mutation') { note(at, `\`mx.${method}\` names \`${name}\`, which is not a declared Value or Query`); return; }
      }
      if (method === 'read') {
        const options = args[1];
        if (options?.type === 'ObjectExpression' && options.properties.some((p) => p.type === 'ObjectProperty' && keyName(p.key) === 'refresh')) {
          note(at, '`refresh` has no equivalent: a Query re-runs when what it reads changes; this waits for the run in flight');
        }
      }
      for (const name of names) registry.adapter.add(name);
      if (method === 'subscribe') registry.solid.add('createRoot').add('createEffect');
      edits.push({ start: callee.start!, end: callee.end!, text: method === 'read' ? 'mxRead' : 'mxSubscribe' });
      registry.applied.add('`mx.read`/`mx.subscribe` → `mxRead`/`mxSubscribe`, the old snapshot shape over the bindings');
    },
  });

  // A frame's own document is the page's now: its lookups and its body are scoped to the frame's root.
  if (piece.framed) {
    const root = piece.root ? `document.getElementById(${jsString(piece.root)})` : null;
    traverse(ast, {
      MemberExpression(path) {
        const { object, property } = path.node;
        if (object.type !== 'Identifier' || object.name !== 'document' || path.node.computed || property.type !== 'Identifier' || path.scope.hasBinding('document')) return;
        const assigned = path.parentPath.isAssignmentExpression() && path.parentPath.node.left === path.node;
        if (root && FRAME_LOOKUPS.has(property.name)) edits.push({ start: object.start!, end: object.end!, text: root });
        else if (root && property.name === 'body' && !assigned) edits.push({ start: path.node.start!, end: path.node.end!, text: root });
        else if (property.name === 'body' || property.name === 'documentElement') {
          note(statementOf(path).node.start!, `\`document.${property.name}\` was the frame's; it is the page's now`);
          return;
        } else return;
        registry.applied.add('an inlined frame\'s `document.querySelector`/`querySelectorAll`/`body` → scoped to the frame\'s root');
      },
    });
  }

  // Exported Preact-style components: destructured props were signals there, getters here.
  for (const statement of ast.program.body) {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : null;
    const fn = declaration?.type === 'FunctionDeclaration' ? declaration
      : declaration?.type === 'VariableDeclaration' ? declaration.declarations[0]?.init : null;
    const param = fn && (fn.type === 'FunctionDeclaration' || fn.type === 'ArrowFunctionExpression' || fn.type === 'FunctionExpression') ? fn.params[0] : null;
    if (param?.type === 'ObjectPattern') note(statement.start!, 'a component destructures its props; read `props.x` (a getter, already the value) instead');
  }

  // What a dropped promise chain held goes with it: its rewrites and its notes.
  const inside = (start: number, end: number) => dropped.some((d) => start >= d.start && end <= d.end);
  if (dropped.length) edits = edits.filter((edit) => dropped.some((d) => d.by === edit) || !inside(edit.start, edit.end));
  for (const { pos, message } of notes) if (!dropped.some((d) => pos > d.start && pos < d.end)) registry.note(`${message} (script line ${lineOf(code, pos)})`);
  if (!edits.length) return { code, changed: false, imports };
  return { code: applyEdits(code, edits), changed: true, imports };
}

/** The adapter `mx.read`/`mx.subscribe` become: the old snapshot shape, `{ signals: { name: { value, status, error? } } }`. */
function adapterLines(registry: Registry): string[] {
  if (!registry.adapter.size) return [];
  const entries = [...registry.adapter].map((name) => {
    const binding = registry.bindings.get(name)!;
    return `${JSON.stringify(name)}: [${JSON.stringify(binding.kind)}, ${binding.local}]`;
  });
  return [
    '/* migrated from mx: the old snapshot shape, { signals: { name: { value, status, error? } } }, over the bindings */',
    `const mxBindings = { ${entries.join(', ')} };`,
    'const mxSnapshot = (names) => ({ signals: Object.fromEntries(names.map((name) => {',
    '  const [kind, read] = mxBindings[name];',
    "  if (kind === 'value') return [name, { value: read(), status: 'ready' }];",
    '  const rows = read(), error = read.error();',
    "  return [name, { value: { rows, columns: Object.keys(rows[0] ?? {}) }, status: read.loading() ? 'pending' : error ? 'error' : 'ready', ...(error ? { error: { code: 'QUERY_ERROR', message: error } } : {}) }];",
    '})) });',
    'const mxRead = async (names, options = {}) => {',
    "  if (options.wait || options.refresh) await Promise.all(names.filter((name) => mxBindings[name][0] === 'query').map((name) => mxBindings[name][1].ready));",
    '  return mxSnapshot(names);',
    '};',
    'const mxSubscribe = (names, fn) => createRoot((dispose) => { createEffect(() => fn(mxSnapshot(names))); return dispose; });',
  ];
}

/** A compound selector's qualifiers after its type (`.a#b[c]:d(e)::f`), as the scope's own. */
const QUALIFIERS = /^(?:[.#][\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?)*/;

/**
 * `body`, `html` and `:root` become the scope, their qualifiers its own (`body.ready` → `#f.ready`, `html.wide body` →
 * `#f.wide`: the frame's html and body are one element now); every other selector is prefixed with it. Nested at-rules
 * are scoped too.
 */
export function scopeCss(css: string, scope: string): string {
  let out = '';
  let i = 0;
  const skipString = (from: number): number => {
    const quote = css[from]!;
    let j = from + 1;
    while (j < css.length && css[j] !== quote) j += css[j] === '\\' ? 2 : 1;
    return j + 1;
  };
  /** The end of the block that opens at `open` (`{`), past its `}`. */
  const blockEnd = (open: number): number => {
    let depth = 0;
    for (let j = open; j < css.length;) {
      const c = css[j]!;
      if (c === '"' || c === "'") { j = skipString(j); continue; }
      if (c === '/' && css[j + 1] === '*') { const close = css.indexOf('*/', j + 2); j = close < 0 ? css.length : close + 2; continue; }
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) return j + 1;
      j++;
    }
    return css.length;
  };
  const scopeSelector = (selector: string): string => {
    const lead = /^\s*/.exec(selector)![0];
    const body = selector.slice(lead.length);
    if (!body) return selector;
    const top = /^(?:html|:root|body)(?![\w-])/.exec(body);
    if (!top) return `${lead}${scope} ${body}`;
    let rest = body.slice(top[0].length);
    let qualifiers = QUALIFIERS.exec(rest)![0];
    rest = rest.slice(qualifiers.length);
    const inner = top[0] === 'body' ? null : /^(?:\s*>\s*|\s+)body(?![\w-])/.exec(rest);
    if (inner) {
      rest = rest.slice(inner[0].length);
      const more = QUALIFIERS.exec(rest)![0];
      qualifiers += more;
      rest = rest.slice(more.length);
    }
    return `${lead}${scope}${qualifiers}${rest}`;
  };
  const splitSelectors = (prelude: string): string[] => {
    const parts: string[] = [];
    let depth = 0, from = 0;
    for (let j = 0; j < prelude.length; j++) {
      const c = prelude[j];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) { parts.push(prelude.slice(from, j)); from = j + 1; }
    }
    parts.push(prelude.slice(from));
    return parts;
  };
  while (i < css.length) {
    const c = css[i]!;
    if (/\s/.test(c)) { out += c; i++; continue; }
    if (c === '/' && css[i + 1] === '*') { const close = css.indexOf('*/', i + 2); const end = close < 0 ? css.length : close + 2; out += css.slice(i, end); i = end; continue; }
    // A prelude runs to its `{` (a rule) or `;` (an at-statement).
    let j = i;
    while (j < css.length && css[j] !== '{' && css[j] !== ';') j = css[j] === '"' || css[j] === "'" ? skipString(j) : j + 1;
    const prelude = css.slice(i, j);
    if (css[j] !== '{') { out += css.slice(i, Math.min(j + 1, css.length)); i = j + 1; continue; }
    const end = blockEnd(j);
    const inner = css.slice(j + 1, end - 1);
    if (/^@(?:media|supports|container|layer|document)\b/i.test(prelude)) out += `${prelude}{${scopeCss(inner, scope)}}`;
    else if (prelude.startsWith('@')) out += css.slice(i, end);
    else out += `${splitSelectors(prelude).map(scopeSelector).join(',')}{${inner}}`;
    i = end;
  }
  return out;
}

const stringAttr = (el: JsxElement, name: string): string | null => {
  const attr = el.attributes.find((a) => a.name === name);
  return attr?.value.static && typeof attr.value.json === 'string' ? attr.value.json : null;
};
const numberAttr = (el: JsxElement, name: string): number | null => {
  const attr = el.attributes.find((a) => a.name === name);
  return attr?.value.static && typeof attr.value.json === 'number' ? attr.value.json : null;
};
const textOf = (el: JsxElement): string | null => {
  const children = el.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
  if (children.length !== 1) return children.length ? null : '';
  const only = children[0]!;
  if (only.type === 'text') return only.value;
  return only.type === 'expression' && only.value.static && typeof only.value.json === 'string' ? only.value.json : null;
};

function findIframes(nodes: JsxNode[], out: JsxElement[] = []): JsxElement[] {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (node.isComponent && node.tag === 'Iframe') { out.push(node); continue; }
    findIframes(node.children, out);
  }
  return out;
}

/** Ids a document's markup gives its elements (an inlined frame's must not collide with them). */
function idsOf(nodes: JsxNode[], out = new Map<string, number>()): Map<string, number> {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    const id = stringAttr(node, 'id');
    if (id) out.set(id, (out.get(id) ?? 0) + 1);
    idsOf(node.children, out);
  }
  return out;
}

interface FramePlan { iframe: JsxElement; id: string; css: string; scripts: string[]; content: string; label: string; height: number | null }

/** A frame's children that do not move into the body: its style and script (merged into the Helmet) and its `<title>`. */
const FRAME_HEAD_TAGS = new Set(['style', 'script', 'title']);

const indentOf = (code: string): string => /^[ \t]*(?=\S)/m.exec(code)?.[0] ?? '    ';
const reindent = (code: string, indent: string): string => {
  const lines = code.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const common = Math.min(...lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
  return lines.map((l) => (l.trim() ? indent + l.slice(Number.isFinite(common) ? common : 0) : '')).join('\n');
};

export function migrateDocumentScripts(source: string): DocumentMigration {
  const unchanged = (unresolved: string[] = []): DocumentMigration => ({ source, changed: false, applied: [], unresolved });
  const parsed = parseJsx(source);
  if (!parsed.ok) return unchanged([`the document does not parse (${parsed.error}); migrate it by hand`]);
  const { helmet, content, body } = splitHelmet(parsed.nodes);
  const iframes = findIframes(body);
  const scriptEl = helmet?.children.find((c): c is JsxElement => c.type === 'element' && c.tag === 'script') ?? null;
  const scriptExpr = scriptEl?.children.find((c) => c.type === 'expression') ?? null;
  const mainCode = content.script;
  if (!mainCode && !iframes.length) return unchanged();

  const docEdits: Edit[] = [];
  const pendingHelmet: string[] = [];
  const unresolvedMarkup: string[] = [];
  const appliedMarkup: string[] = [];
  const markupNote = (pos: number, message: string) => {
    unresolvedMarkup.push(message);
    const comment = `{/* MIGRATE: ${message} */}`;
    const before = source.slice(0, pos).trimEnd();
    if (!before.endsWith(comment)) docEdits.push({ start: pos, end: pos, text: `${comment}\n` });
  };

  // Plan each Iframe: inline it, or say why not.
  const ids = idsOf(body);
  const frames: FramePlan[] = [];
  let generated = 0;
  for (const iframe of iframes) {
    const css: string[] = [];
    const scripts: string[] = [];
    let content = '';
    let refused: string | null = null;
    let titles = 0;
    for (const child of iframe.children) {
      if (child.type === 'element' && child.tag === 'style') {
        const text = textOf(child);
        if (text === null) refused = 'its <style> is not static text';
        else css.push(text);
      } else if (child.type === 'element' && child.tag === 'title') {
        titles++;
      } else if (child.type === 'element' && child.tag === 'script') {
        if (child.attributes.some((a) => a.name === 'src')) refused = 'it loads a classic library by <script src>; import it as a module (`import … from \'name\'`) and inline the frame by hand';
        const text = textOf(child);
        if (text === null) refused ??= 'its <script> is not static text';
        else if (text.trim()) scripts.push(text);
      }
    }
    if (iframe.children.length) {
      let at = iframe.children[0]!.start;
      for (const child of iframe.children) {
        if (child.type !== 'element' || !FRAME_HEAD_TAGS.has(child.tag)) continue;
        // A child alone on its lines leaves no blank line behind.
        const lineStart = source.lastIndexOf('\n', child.start - 1) + 1;
        const after = /^[ \t]*\n/.exec(source.slice(child.end));
        const whole = !source.slice(lineStart, child.start).trim() && !!after && lineStart >= at;
        content += source.slice(at, whole ? lineStart : child.start);
        at = whole ? child.end + after![0].length : child.end;
      }
      content += source.slice(at, iframe.children.at(-1)!.end);
    }
    const innerIds = idsOf(iframe.children.filter((c) => c.type === 'element' && !FRAME_HEAD_TAGS.has(c.tag)));
    for (const [id] of innerIds) if ((ids.get(id) ?? 0) > (innerIds.get(id) ?? 0)) refused ??= `the id "${id}" inside it is also used outside it`;
    const label = stringAttr(iframe, 'title') ?? 'Iframe';
    if (refused) { markupNote(iframe.start, `<Iframe> "${label}" was not inlined: ${refused}`); continue; }
    let id = stringAttr(iframe, 'id');
    if (!id) { do id = `migrated-frame-${++generated}`; while (ids.has(id)); ids.set(id, 1); }
    if (titles) appliedMarkup.push(`<Iframe> "${label}": its <title> (the frame's tab title) dropped`);
    frames.push({ iframe, id, css: css.join('\n'), scripts, content, label, height: numberAttr(iframe, 'height') });
  }

  // Parse every script piece first: generated names must avoid every identifier in any of them.
  const pieces: Piece[] = [];
  const taken: Names = { top: new Set<string>(), all: new Set<string>() };
  const parseFailure = (where: string) => `${where} does not parse as a module; migrate it by hand`;
  let main: Piece | null = null;
  const unresolvedParse: string[] = [];
  if (mainCode) {
    const ast = parseScript(mainCode);
    if (ast) { main = { code: mainCode, ast, framed: false }; pieces.push(main); namesOf(ast, taken); }
    else unresolvedParse.push(parseFailure('the Helmet script'));
  }
  const framePieces = new Map<FramePlan, Piece[]>();
  for (const frame of frames) {
    const list: Piece[] = [];
    for (const code of frame.scripts) {
      const ast = parseScript(code);
      if (!ast) { unresolvedParse.push(parseFailure(`the script of <Iframe> "${frame.label}"`)); continue; }
      const piece: Piece = { code, ast, framed: true, root: frame.id };
      list.push(piece);
      namesOf(ast, taken);
    }
    framePieces.set(frame, list);
  }
  if (unresolvedParse.length) return unchanged(unresolvedParse);
  const authorNames = new Set(taken.all);

  const registry = new Registry(declaredKinds(content), taken);
  let mainResult: PieceResult | null = null;
  try {
    if (main) mainResult = migratePiece(main, registry);
    for (const frame of frames) {
      const results = framePieces.get(frame)!.map((piece) => migratePiece(piece, registry));
      frame.scripts = results.map((r) => r.code);
      (frame as FramePlan & { imports?: string[] }).imports = results.flatMap((r) => r.imports);
    }
  } catch (error) {
    return unchanged([`the script could not be rewritten automatically (${error instanceof Error ? error.message : String(error)}); migrate it by hand`]);
  }

  // The adapter's names are the script's own already: say so rather than shadow them.
  if (registry.adapter.size) {
    const clashes = ['mxBindings', 'mxSnapshot', 'mxRead', 'mxSubscribe'].filter((name) => authorNames.has(name));
    if (clashes.length) return unchanged(clashes.map((name) => `the script already uses the name \`${name}\`; rename it before migrating`));
  }
  const scriptChanged = !!mainResult?.changed || frames.some((f) => f.scripts.length);
  if (scriptChanged) {
    const indent = indentOf(mainCode ?? '    ');
    // What the script already imports from 'page' and 'solid-js' (a header adds only the rest).
    const existing = { page: new Set<string>(), solid: new Set<string>() };
    if (main) for (const s of main.ast.program.body) {
      if (s.type !== 'ImportDeclaration') continue;
      const target = s.source.value === 'page' ? existing.page : s.source.value === 'solid-js' ? existing.solid : null;
      for (const spec of s.specifiers) if (target && spec.type === 'ImportSpecifier' && keyName(spec.imported) === spec.local.name) target.add(spec.local.name);
    }
    const header: string[] = [];
    const binders = PAGE_BINDERS.filter((b) => registry.binders.has(b) && !existing.page.has(b));
    const removedPage = !!main && main.ast.program.body.some((s) => s.type === 'ImportDeclaration' && s.source.value === 'page'
      && s.specifiers.some((spec) => spec.type !== 'ImportSpecifier' || !(PAGE_BINDERS as readonly string[]).includes(keyName(spec.imported) ?? '')));
    // A rewritten old `page` import is removed whole: re-import every binder it needs.
    const pageNames = removedPage ? PAGE_BINDERS.filter((b) => registry.binders.has(b)) : binders;
    // A binder the script already uses as a name of its own is imported under another.
    const used = new Set<string>();
    for (const code of [mainResult?.code ?? '', ...frames.flatMap((f) => f.scripts)]) {
      const ast = parseScript(code);
      if (ast) traverse(ast, { Identifier(path) { if (!path.parentPath.isImportSpecifier()) used.add(path.node.name); } });
    }
    const binderLocal = new Map<string, string>(pageNames.map((b) => [b, used.has(b) && !existing.page.has(b) ? registry.fresh(`page${capitalize(b)}`) : b]));
    if (pageNames.length) header.push(`import { ${pageNames.map((b) => (binderLocal.get(b) === b ? b : `${b} as ${binderLocal.get(b)}`)).join(', ')} } from 'page';`);
    const binder = (b: string) => binderLocal.get(b) ?? b;
    const solid = [...registry.solid].filter((name) => !existing.solid.has(name)).sort();
    if (solid.length) header.push(`import { ${solid.join(', ')} } from 'solid-js';`);
    for (const frame of frames) header.push(...((frame as FramePlan & { imports?: string[] }).imports ?? []));
    for (const binding of registry.bindings.values()) {
      header.push(binding.kind === 'value'
        ? `const [${binding.local}, ${binding.setter}] = ${binder('signal')}('$${binding.name}');`
        : `const ${binding.local} = ${binder(binding.kind)}('$${binding.name}');`);
    }
    header.push(...adapterLines(registry));
    const headerText = header.map((line) => indent + line).join('\n');
    let code = mainResult?.code ?? '';
    if (headerText) {
      const lead = /^\s*/.exec(code)![0];
      code = `\n${headerText}\n${code.trim() ? `\n${indent}${code.slice(lead.length)}` : ''}`;
    }
    for (const frame of frames) {
      if (!frame.scripts.length) continue;
      const block = frame.scripts.map((s) => reindent(s, `${indent}  `)).join('\n');
      code = `${code.replace(/\s+$/, '')}\n\n${indent}/* ${IFRAME_NOTE} "${frame.label}" (#${frame.id}) */\n${indent}{\n${block}\n${indent}}\n`;
    }
    if (!/\n\s*$/.test(code)) code += '\n';
    if (mainCode && !code.endsWith(/\n([ \t]*)$/.exec(mainCode)?.[0] ?? '\n')) code = code.replace(/\n[ \t]*$/, /\n[ \t]*$/.exec(mainCode)?.[0] ?? '\n');
    const literal = `{\`${escapeTemplate(code)}\`}`;
    if (scriptExpr) docEdits.push({ start: scriptExpr.start, end: scriptExpr.end, text: literal });
    else helmetInsert(`<script>${literal}</script>`);
  }

  // Frames into the body, their styles (and the height each frame reserved) into the Helmet's.
  const frameCss = (f: FramePlan): string => [f.css.trim() ? scopeCss(f.css.trim(), `#${f.id}`) : '', f.height ? `#${f.id} { min-height: ${f.height}px; }` : ''].filter(Boolean).join('\n');
  const css = frames.filter((f) => f.css.trim() || f.height).map((f) => `/* ${IFRAME_NOTE} "${f.label}" */\n${frameCss(f)}`).join('\n');
  if (css) {
    const styleEl = helmet?.children.find((c): c is JsxElement => c.type === 'element' && c.tag === 'style') ?? null;
    const styleExpr = styleEl?.children.find((c) => c.type === 'expression') ?? null;
    if (styleEl && styleExpr && content.style !== null) docEdits.push({ start: styleExpr.start, end: styleExpr.end, text: `{\`${escapeTemplate(`${content.style.replace(/\s+$/, '')}\n${css}\n`)}\`}` });
    else if (styleEl) markupNote(styleEl.start, 'the Helmet <style> is not one static template literal; append the inlined frames\' CSS by hand');
    else helmetInsert(`<style>{\`\n${escapeTemplate(css)}\n\`}</style>`);
  }
  for (const frame of frames) {
    const label = frame.label === 'Iframe' ? '' : ` role="group" aria-label=${JSON.stringify(frame.label)}`;
    docEdits.push({ start: frame.iframe.start, end: frame.iframe.end, text: `{/* ${IFRAME_NOTE} */}\n<div id="${escapeHtml(frame.id)}"${label}>${frame.content}</div>` });
    appliedMarkup.push(`<Iframe> "${frame.label}" → inlined as the <div> with id "${frame.id}", its style scoped into the Helmet style, its script merged into the Helmet script`);
  }
  flushHelmetInserts();

  const unresolved = [...registry.unresolved, ...unresolvedMarkup];
  if (!docEdits.length) return { ...unchanged(unresolved) };
  let next: string;
  try { next = applyEdits(source, docEdits); }
  catch (error) { return unchanged([`the document could not be rewritten automatically (${error instanceof Error ? error.message : String(error)})`]); }
  return { source: next, changed: next !== source, applied: [...registry.applied, ...appliedMarkup], unresolved };

  // Helmet insertions (a new <style>/<script>, or a new Helmet), gathered so both land in one edit.
  function helmetInsert(element: string): void { pendingHelmet.push(element); }
  function flushHelmetInserts(): void {
    if (!pendingHelmet.length) return;
    const inner = pendingHelmet.map((el) => `  ${el}`).join('\n');
    if (helmet && !helmet.selfClosing) {
      const close = source.lastIndexOf('</Helmet>', helmet.end);
      const lineStart = source.lastIndexOf('\n', close - 1) + 1;
      const own = !source.slice(lineStart, close).trim();
      docEdits.push(own ? { start: lineStart, end: lineStart, text: `${inner}\n` } : { start: close, end: close, text: `\n${inner}\n` });
    } else if (helmet) docEdits.push({ start: helmet.start, end: helmet.end, text: `<Helmet>\n${inner}\n</Helmet>` });
    else docEdits.push({ start: 0, end: 0, text: `<Helmet>\n${inner}\n</Helmet>\n` });
  }
}
