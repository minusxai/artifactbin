/**
 * A typeDefs-free backend's `roles`, read from its SOURCE at publish and never evaluated (./functions
 * `functionManifest` then checks each name and role). Evaluating the export cannot be trusted: a getter, a
 * non-enumerable property, a Proxy or a prototype can each hide an entry from what serialization sees, and a dropped
 * entry silently means "anyone". So the one accepted form is a declaration the text itself proves:
 *
 *   export const roles = { items: 'viewer', 'save': 'owner' };   // or `const r = {…}; export { r as roles }`
 *
 * an object literal of plain `key: 'role'` properties, each key an identifier or a string literal (never computed,
 * never `__proto__`, never repeated) and each value a string literal. Anything else — a spread, a getter or method,
 * shorthand, a non-literal value, a call, `let`/`var`, a re-export from elsewhere — fails publish (`invalid_roles`).
 * TypeScript-only syntax (`as const`, `satisfies`) is stripped by esbuild first, and esbuild folds a concatenation of
 * string literals (`'own' + 'er'`) to its literal: text folding, never evaluation. A template literal is refused.
 */
import { parse } from 'acorn';
import { transform } from 'esbuild';

type Node = { type: string; [key: string]: unknown };
const refuse = (why: string): never => { throw Error(`invalid_roles: ${why}; declare export const roles = {name: 'owner' | 'editor' | 'viewer' | 'signed_in' | 'anonymous', …} as an object literal`); };

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

/** The declared `[name, role]` pairs, or null when the file exports no `roles`. */
export async function declaredRoles(source: string): Promise<Array<[string, string]> | null> {
  const code = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code;
  const program = parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as { body: Node[] };
  const constants = new Map<string, { kind: string; init: Node | null }>();
  let declared: { kind: string; init: Node | null } | 'alias' | null = null, alias: string | null = null;
  for (const statement of program.body) {
    const declaration = (statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement) as Node | null;
    if (declaration?.type === 'VariableDeclaration')
      for (const item of declaration.declarations as Node[]) {
        const id = item.id as Node;
        if (id.type !== 'Identifier') { if (statement.type === 'ExportNamedDeclaration' && boundNames(id).includes('roles')) refuse('roles is destructured'); continue; }
        const entry = { kind: String(declaration.kind), init: (item.init as Node | null) ?? null };
        constants.set(String(id.name), entry);
        if (statement.type === 'ExportNamedDeclaration' && id.name === 'roles') declared = entry;
      }
    if (statement.type === 'ExportNamedDeclaration' && !statement.declaration)
      for (const specifier of (statement.specifiers as Node[]) ?? []) {
        const exported = specifier.exported as Node;
        if ((exported.type === 'Identifier' ? exported.name : exported.value) !== 'roles') continue;
        if (statement.source) refuse('roles is re-exported from another module');
        declared = 'alias'; alias = String((specifier.local as Node).name);
      }
  }
  if (declared === null) return null;
  const binding = declared === 'alias' ? constants.get(alias!) : declared;
  if (!binding) refuse(`roles names ${alias}, which is not a top-level const of this file`);
  if (binding!.kind !== 'const') refuse('roles must be a const');
  const literal = binding!.init;
  if (literal?.type !== 'ObjectExpression') refuse('roles must be an object literal, not a computed value');
  const pairs: Array<[string, string]> = [], seen = new Set<string>();
  for (const property of literal!.properties as Node[]) {
    if (property.type !== 'Property') refuse('roles may not spread another object');
    if (property.kind !== 'init' || property.method) refuse('roles may not use getters, setters or methods');
    if (property.computed) refuse('roles keys may not be computed ([…])');
    if (property.shorthand) refuse('roles values must be written out as string literals');
    const key = property.key as Node;
    const name = key.type === 'Identifier' ? String(key.name) : key.type === 'Literal' && typeof key.value === 'string' ? key.value : refuse('roles keys must be identifiers or string literals');
    if (name === '__proto__') refuse('__proto__ is not a function name roles may name');
    if (seen.has(name)) refuse(`roles names ${name} twice`);
    seen.add(name);
    const value = property.value as Node;
    if (value.type !== 'Literal' || typeof value.value !== 'string') refuse(`roles.${name} must be a string literal role name`);
    pairs.push([name, value.value as string]);
  }
  return pairs;
}
