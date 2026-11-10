/**
 * A typeDefs-free backend's WHOLE callable surface, read from its SOURCE at publish and never from the evaluated
 * module (./functions `functionManifest` then checks each name and role). An evaluated module is author-controlled:
 * a getter, a non-enumerable property, a prototype or a Proxy can each show serialization something other than what
 * the code runs, and an entry it hides silently means "anyone". So both halves come from the text alone:
 *
 *  · CALLABLE NAMES: the keys of `export default { items() {…}, save: async () => {…} }` (an object literal written
 *    inline, or a top-level const exported as default), and the file's named exported functions
 *    (`export function f`, `export const f = () => …`, `export { f }`). Only these may ever be invoked (the runner
 *    looks up exactly that name); a key whose run-time value is not a function answers 404, as an unknown name does.
 *  · ROLES: `export const roles = { items: 'viewer', 'save': 'owner' }` — an object literal of plain `key: 'role'`
 *    properties, keys identifiers or string literals (never computed, never `__proto__`, never repeated), values
 *    string literals.
 *
 * Nothing may rewrite the module behind the text's back: a typeDefs-free file that names `module`, `exports`,
 * `require` or `eval`, imports dynamically, or re-exports (`export *`, `export … from`) fails publish
 * (`invalid_functions`), as does a default export that is not an object literal (a Proxy, a call, a class) or one
 * with spreads, computed keys or accessors. A file with typeDefs keeps its names from the SDL (static already).
 * TypeScript-only syntax is stripped by esbuild first; it also folds string-literal concatenation (`'own' + 'er'`):
 * text folding, never evaluation.
 */
import { parse } from 'acorn';
import { transform } from 'esbuild';

type Node = { type: string; [key: string]: unknown };
const ROLES_FORM = "declare export const roles = {name: 'owner' | 'editor' | 'viewer' | 'signed_in' | 'anonymous', …} as an object literal";
const FUNCTIONS_FORM = 'export your functions as export default {name(args, principal, caps) {…}, …} (an object literal) or as export function name(…) {…}';
const refuseRoles = (why: string): never => { throw Error(`invalid_roles: ${why}; ${ROLES_FORM}`); };
const refuseFunctions = (why: string): never => { throw Error(`invalid_functions: ${why}; ${FUNCTIONS_FORM}`); };
/** Exports that are configuration, never callable. */
const RESERVED = new Set(['default', 'roles', 'secrets', 'typeDefs']);
const NAME = /^[_A-Za-z][_0-9A-Za-z]{0,63}$/;
/** Free names through which a module could replace or extend its exports at run time. */
const MODULE_HANDLES = new Set(['module', 'exports', 'require', 'eval']);

export interface FunctionSurface {
  /** The file exports `typeDefs` (a legacy SDL file): its callable names are its SDL's. */
  typeDefs: boolean;
  /** A typeDefs-free file's callable names, in source order. */
  functions: string[];
  /** The declared `[name, role]` pairs, or null when the file exports no `roles`. */
  roles: Array<[string, string]> | null;
}

/** The names a destructuring pattern binds. */
function boundNames(pattern: Node): string[] {
  switch (pattern.type) {
    case 'Identifier': return [String(pattern.name)];
    case 'ObjectPattern': return (pattern.properties as Node[]).flatMap((p) => boundNames((p.type === 'RestElement' ? p.argument : p.value) as Node));
    case 'ArrayPattern': return (pattern.elements as Array<Node | null>).flatMap((e) => (e ? boundNames(e) : []));
    case 'RestElement': return boundNames(pattern.argument as Node);
    case 'AssignmentPattern': return boundNames(pattern.left as Node);
    default: return [];
  }
}
const keyName = (property: Node): string | null => {
  const key = property.key as Node;
  return property.computed ? null : key.type === 'Identifier' ? String(key.name) : key.type === 'Literal' && typeof key.value === 'string' ? key.value : null;
};
const isFunction = (node: Node | null | undefined) => node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression' || node?.type === 'FunctionDeclaration';

/** Every node of the tree, with the key it hangs from in its parent. */
function walk(node: Node, visit: (node: Node, parent: Node | null, key: string) => void, parent: Node | null = null, key = ''): void {
  visit(node, parent, key);
  for (const [field, value] of Object.entries(node)) {
    if (field === 'loc' || field === 'range') continue;
    if (Array.isArray(value)) { for (const item of value) if (item && typeof item === 'object' && typeof (item as Node).type === 'string') walk(item as Node, visit, node, field); }
    else if (value && typeof value === 'object' && typeof (value as Node).type === 'string') walk(value as Node, visit, node, field);
  }
}

export async function staticSurface(source: string): Promise<FunctionSurface> {
  const code = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
  const program = parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Node & { body: Node[] };
  /** Top-level bindings: how each was declared and its initializer (or the declaration itself for a function). */
  const bindings = new Map<string, { kind: string; init: Node | null }>();
  /** Exported name → the local binding, or the inline node. */
  const exported = new Map<string, { local?: string; node?: Node | null; kind?: string }>();
  const problems: string[] = [];
  let defaultExport: Node | null = null;
  for (const statement of program.body) {
    const declaration = (statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement) as Node | null;
    const exporting = statement.type === 'ExportNamedDeclaration';
    if (declaration?.type === 'VariableDeclaration')
      for (const item of declaration.declarations as Node[]) {
        const id = item.id as Node;
        if (id.type !== 'Identifier') {
          if (exporting) for (const name of boundNames(id)) { if (name === 'roles') refuseRoles('roles is destructured'); exported.set(name, { node: null, kind: 'pattern' }); }
          continue;
        }
        const entry = { kind: String(declaration.kind), init: (item.init as Node | null) ?? null };
        bindings.set(String(id.name), entry);
        if (exporting) exported.set(String(id.name), { node: entry.init, kind: entry.kind });
      }
    if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') {
      const name = String((declaration.id as Node | null)?.name ?? '');
      if (name) bindings.set(name, { kind: declaration.type === 'FunctionDeclaration' ? 'function' : 'class', init: declaration });
      if (exporting && name) exported.set(name, { node: declaration, kind: declaration.type === 'FunctionDeclaration' ? 'function' : 'class' });
    }
    if (exporting && !statement.declaration)
      for (const specifier of (statement.specifiers as Node[]) ?? []) {
        const out = specifier.exported as Node, name = String(out.type === 'Identifier' ? out.name : out.value);
        if (statement.source) { if (name === 'roles') refuseRoles('roles is re-exported from another module'); problems.push(`${name} is re-exported from another module`); continue; }
        exported.set(name, { local: String((specifier.local as Node).name) });
      }
    if (statement.type === 'ExportAllDeclaration') problems.push('export * re-exports another module');
    if (statement.type === 'ExportDefaultDeclaration') defaultExport = statement.declaration as Node;
  }
  /** An export resolved to its node: inline, or through a top-level binding (`const x = …; export { x }`). */
  const resolve = (name: string): { kind: string; init: Node | null } | null => {
    const entry = exported.get(name);
    if (!entry) return null;
    if (entry.local !== undefined) return bindings.get(entry.local) ?? { kind: 'unknown', init: null };
    return { kind: entry.kind ?? 'unknown', init: entry.node ?? null };
  };

  // ROLES.
  let roles: Array<[string, string]> | null = null;
  if (exported.has('roles')) {
    const binding = resolve('roles')!;
    if (binding.kind !== 'const') refuseRoles('roles must be a top-level const of this file');
    const literal = binding.init;
    if (literal?.type !== 'ObjectExpression') refuseRoles('roles must be an object literal, not a computed value');
    roles = [];
    const seen = new Set<string>();
    for (const property of literal!.properties as Node[]) {
      if (property.type !== 'Property') refuseRoles('roles may not spread another object');
      if (property.kind !== 'init' || property.method) refuseRoles('roles may not use getters, setters or methods');
      if (property.computed) refuseRoles('roles keys may not be computed ([…])');
      if (property.shorthand) refuseRoles('roles values must be written out as string literals');
      const name = keyName(property) ?? refuseRoles('roles keys must be identifiers or string literals');
      if (name === '__proto__') refuseRoles('__proto__ is not a function name roles may name');
      if (seen.has(name)) refuseRoles(`roles names ${name} twice`);
      seen.add(name);
      const value = property.value as Node;
      if (value.type !== 'Literal' || typeof value.value !== 'string') refuseRoles(`roles.${name} must be a string literal role name`);
      roles.push([name, value.value as string]);
    }
  }
  if (exported.has('typeDefs')) return { typeDefs: true, functions: [], roles };

  // THE MODULE STAYS WHAT ITS TEXT SAYS.
  if (problems.length) refuseFunctions(problems[0]!);
  walk(program, (node, parent, key) => {
    if (node.type === 'ImportExpression') refuseFunctions('a dynamic import() is not allowed');
    if (node.type !== 'Identifier' || !MODULE_HANDLES.has(String(node.name))) return;
    // A property name (`x.module`, `{ module: 1 }`) is not the binding.
    if (parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed) || ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed))) return;
    refuseFunctions(`${String(node.name)} is not available to backend code: its exports are only what export statements declare`);
  });

  // CALLABLE NAMES.
  const functions: string[] = [];
  const add = (name: string) => {
    if (!NAME.test(name)) refuseFunctions(`${JSON.stringify(name)} is not a function name (letters, digits and _)`);
    if (functions.includes(name)) refuseFunctions(`${name} is exported twice`);
    functions.push(name);
  };
  // esbuild writes `export default {…}` as `var stdin_default = {…}; export { stdin_default as default }`, and
  // `export default api` as `var stdin_default = api`: follow the chain of bindings to the literal, refusing a binding
  // the code ever assigns again (it could become a Proxy after the text was read).
  const assigned = new Set<string>();
  walk(program, (node) => {
    const target = node.type === 'AssignmentExpression' ? node.left as Node : node.type === 'UpdateExpression' ? node.argument as Node : null;
    for (const name of target ? boundNames(target) : []) assigned.add(name);
  });
  let literal: Node | null = defaultExport ?? (exported.has('default') ? resolve('default')!.init : null);
  let chain = exported.get('default')?.local ?? null;
  for (let hops = 0; hops <= 8; hops++) {
    if (chain !== null && assigned.has(chain)) refuseFunctions(`the default export ${chain} is reassigned`);
    if (literal?.type !== 'Identifier') break;
    chain = String(literal.name);
    const binding = bindings.get(chain);
    literal = binding && binding.kind !== 'class' && binding.kind !== 'function' ? binding.init : null;
  }
  if (defaultExport || exported.has('default')) {
    if (literal?.type !== 'ObjectExpression') refuseFunctions('the default export must be an object literal (not a Proxy, call, class or other value)');
    for (const property of literal!.properties as Node[]) {
      if (property.type !== 'Property') refuseFunctions('the default export may not spread another object');
      if (property.kind !== 'init') refuseFunctions('the default export may not use getters or setters');
      const name = keyName(property) ?? refuseFunctions('the default export\'s keys must be identifiers or string literals, never computed');
      if (name === '__proto__') refuseFunctions('__proto__ is not a function name');
      add(name);
    }
  }
  for (const name of exported.keys()) {
    if (RESERVED.has(name)) continue;
    const binding = resolve(name);
    const callable = binding?.kind === 'function' || (binding?.kind === 'const' && isFunction(binding.init));
    if (callable) add(name);
  }
  return { typeDefs: false, functions, roles };
}
