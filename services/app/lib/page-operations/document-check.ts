/**
 * THE PUBLISH DOCUMENT CHECK: the GraphQL documents a page's code sends, validated at publish against the page's
 * names, so a wrong name is refused with its fix instead of failing every call at run time. Pure: esbuild, acorn and
 * graphql-js only; the caller supplies the schemas (lib/dataset-graphql `pageDatasetCheckSources`).
 *
 * - A resolver's `caps.query(document)` runs on the page's datasets alone (lib/dataset-graphql
 *   `executeLinkedDatasetGraphql`: no viewer, no resolver namespaces), so it is validated against `datasetSdl`.
 * - The page's own `gql` documents run on the composed page schema (datasets, resolver namespaces, `viewer`), so
 *   they are validated against `composePageSchema`. A top-level field that is not a page backend by the client's
 *   rule (lib/html-runtime/apollo `isBackend`) is local state and never checked, with one exception: a dataset's own
 *   API name that cannot be local (it carries arguments in a query, which local fields refuse, or it is a mutation
 *   field on a page that registers no local mutations).
 *
 * A dataset field written under the dataset's own API name (what `graphql.mjs schema DATASET_ID` lists) while the
 * page links it under another names the exact replacement (`renames`); any other unknown root lists the closest
 * root names. Extraction is conservative: only a plain string or expression-free template literal (directly, or
 * through a module `const` declared once) that parses as an executable GraphQL document counts; everything dynamic is
 * skipped. Schemas are role-independent supersets, so a document valid for any caller is never reported.
 */
import { parse as parseJs } from 'acorn';
import { transform } from 'esbuild';
import {
  buildSchema,
  Kind,
  NoUnusedFragmentsRule,
  NoUnusedVariablesRule,
  parse,
  specifiedRules,
  validate,
  visit,
  type DefinitionNode,
  type DocumentNode,
  type FieldNode,
  type GraphQLObjectType,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from 'graphql';
import { PAGE_SQL_ROOT, PAGE_VIEWER_ROOT } from '@artifactbin/contracts';
import { composePageSchema } from './namespaces';

/** One dataset link: its role-independent SDL under its page name, and its own API names → page names. */
interface PageDocumentDataset {
  name: string;
  fileId: string;
  version: string;
  typeDefs: string;
  renames: Readonly<Record<string, string>>;
}
export interface PageDocumentCheck {
  /** Every linked dataset under its page name, as one generated API (caps.query's schema); null with none linked. */
  datasetSdl: string | null;
  datasets: readonly PageDocumentDataset[];
  /** Resolver links whose schema is part of this save. */
  backends: readonly { name: string; typeDefs: string }[];
  /** Resolver links on the page whose schema is not in hand: their fields are skipped, never guessed. */
  unchecked?: readonly string[];
  /** Each resolver source in this save, labelled as reported (`resolver deals.ts`). */
  resolvers: readonly { label: string; source: string }[];
  /** The page's inline script code. */
  scripts: readonly string[];
}

/** At most this many problems are reported for one save. */
const MAX_PROBLEMS = 20;
/** At most this many validation errors per document (the first usually explains the rest). */
const PER_DOCUMENT = 3;
const CLOSEST = 3;

/** Why the page's code would fail on the page's GraphQL, one line each; empty when nothing statically known is wrong. */
export async function pageDocumentProblems(check: PageDocumentCheck): Promise<string[]> {
  const problems = new Set<string>();
  const renames = new Map<string, { link: string; page: string }>();
  for (const dataset of check.datasets) for (const [own, page] of Object.entries(dataset.renames)) renames.set(own, { link: dataset.name, page });
  const datasetSchema = check.datasetSdl ? schemaOf(check.datasetSdl) : null;
  if (datasetSchema) {
    for (const resolver of check.resolvers) {
      for (const text of await resolverDocuments(resolver.source)) {
        const document = executable(text);
        if (document) for (const problem of documentProblems(resolver.label, document, datasetSchema, renames)) problems.add(problem);
      }
    }
  }
  const scripts = check.scripts.flatMap(pageDocuments);
  if (scripts.length) {
    const pageSchema = composedSchema(check);
    if (pageSchema) {
      const localMutations = check.scripts.some((code) => /\baddResolvers\b/.test(code));
      const remote = remoteRule(check);
      for (const text of scripts) {
        const document = executable(text);
        if (document) for (const problem of pageProblems(document, pageSchema, renames, remote, localMutations)) problems.add(problem);
      }
    }
  }
  return [...problems].slice(0, MAX_PROBLEMS);
}

const schemaOf = (sdl: string): GraphQLSchema | null => { try { return buildSchema(sdl); } catch { return null; } };

function composedSchema(check: PageDocumentCheck): GraphQLSchema | null {
  try {
    const composed = composePageSchema([
      ...check.backends.map((backend) => ({ name: backend.name, fileId: backend.name, version: 'prepared', typeDefs: backend.typeDefs })),
      ...check.datasets.map((dataset) => ({ kind: 'dataset-hasura' as const, name: dataset.name, fileId: dataset.fileId, version: dataset.version, typeDefs: dataset.typeDefs })),
    ]);
    return schemaOf(composed.sdl);
  } catch { return null; }
}

/** A parsed document of operations and fragments only, with at least one operation; anything else is not checked. */
function executable(text: string): DocumentNode | null {
  let document: DocumentNode;
  try { document = parse(text, { maxTokens: 10_000 }); } catch { return null; }
  const kinds = document.definitions.map((definition) => definition.kind);
  if (!kinds.includes(Kind.OPERATION_DEFINITION) || kinds.some((kind) => kind !== Kind.OPERATION_DEFINITION && kind !== Kind.FRAGMENT_DEFINITION)) return null;
  return document;
}

// ---- extraction -------------------------------------------------------------------------------------------------

type JsNode = { type: string; [key: string]: unknown };
const isNode = (value: unknown): value is JsNode => !!value && typeof value === 'object' && typeof (value as JsNode).type === 'string';
function walk(node: JsNode, visitNode: (node: JsNode) => void): void {
  visitNode(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) { for (const child of value) if (isNode(child)) walk(child, visitNode); }
    else if (isNode(value)) walk(value, visitNode);
  }
}
function parseProgram(code: string): JsNode | null {
  for (const sourceType of ['module', 'script'] as const) {
    try { return parseJs(code, { ecmaVersion: 'latest', sourceType }) as unknown as JsNode; } catch { /* the next kind, or skipped */ }
  }
  return null;
}

/** A plain string or expression-free template literal's text, or an identifier bound once by `const` to one. */
function literalText(node: unknown, bindings: ReadonlyMap<string, string>): string | undefined {
  if (!isNode(node)) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') {
    const quasis = node.quasis as Array<{ value: { cooked?: string | null } }>;
    return (node.expressions as unknown[]).length === 0 && typeof quasis[0]?.value.cooked === 'string' ? quasis[0].value.cooked : undefined;
  }
  if (node.type === 'Identifier') return bindings.get(node.name as string);
  return undefined;
}

/** Names declared exactly once in the program (any scope) by `const` with a literal: shadowing makes a name dynamic. */
function constLiterals(program: JsNode): Map<string, string> {
  const counts = new Map<string, number>(), values = new Map<string, string>();
  const declare = (pattern: unknown) => {
    if (!isNode(pattern)) return;
    if (pattern.type === 'Identifier') counts.set(pattern.name as string, (counts.get(pattern.name as string) ?? 0) + 1);
    else if (pattern.type === 'AssignmentPattern') declare(pattern.left);
    else if (pattern.type === 'RestElement') declare(pattern.argument);
    else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties as JsNode[]) declare(p.type === 'Property' ? p.value : p);
    else if (pattern.type === 'ArrayPattern') for (const p of pattern.elements as unknown[]) declare(p);
  };
  walk(program, (node) => {
    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations as JsNode[]) {
        declare(declarator.id);
        const id = declarator.id as JsNode;
        const text = node.kind === 'const' && id.type === 'Identifier' ? literalText(declarator.init, new Map()) : undefined;
        if (text !== undefined) values.set(id.name as string, text);
      }
    } else if (/Function/.test(node.type)) {
      declare(node.id);
      for (const param of (node.params as unknown[] | undefined) ?? []) declare(param);
    } else if (node.type === 'CatchClause') declare(node.param);
    else if (node.type === 'ClassDeclaration' || node.type === 'ImportSpecifier' || node.type === 'ImportDefaultSpecifier' || node.type === 'ImportNamespaceSpecifier') declare(node.type === 'ClassDeclaration' ? node.id : node.local);
  });
  for (const name of [...values.keys()]) if (counts.get(name) !== 1) values.delete(name);
  return values;
}

/** The literal documents a resolver passes to `caps.query`. */
async function resolverDocuments(source: string): Promise<string[]> {
  let code: string;
  try { code = (await transform(source, { loader: 'ts', format: 'esm', target: 'es2022' })).code; } catch { return []; }
  const program = parseProgram(code);
  if (!program) return [];
  const bindings = constLiterals(program), out: string[] = [];
  walk(program, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee as JsNode;
    if (callee.type !== 'MemberExpression' || callee.computed) return;
    const object = callee.object as JsNode, property = callee.property as JsNode;
    if (object.type !== 'Identifier' || object.name !== 'caps' || property.type !== 'Identifier' || property.name !== 'query') return;
    const text = literalText((node.arguments as unknown[])[0], bindings);
    if (text !== undefined) out.push(text);
  });
  return out;
}

/** The static documents a page script builds with `gql`: gql`…` without expressions, or gql([literal]). */
function pageDocuments(code: string): string[] {
  const program = parseProgram(code);
  if (!program) return [];
  const bindings = constLiterals(program), out: string[] = [];
  const isGql = (node: unknown) => isNode(node) && node.type === 'Identifier' && node.name === 'gql';
  walk(program, (node) => {
    if (node.type === 'TaggedTemplateExpression' && isGql(node.tag)) {
      const text = literalText(node.quasi, bindings);
      if (text !== undefined) out.push(text);
    } else if (node.type === 'CallExpression' && isGql(node.callee)) {
      const [array] = node.arguments as JsNode[];
      const elements = array?.type === 'ArrayExpression' ? array.elements as unknown[] : [];
      const text = elements.length === 1 ? literalText(elements[0], bindings) : undefined;
      if (text !== undefined) out.push(text);
    }
  });
  return out;
}

// ---- validation -------------------------------------------------------------------------------------------------

const rootOf = (schema: GraphQLSchema, operation: OperationDefinitionNode): GraphQLObjectType | null | undefined =>
  operation.operation === 'query' ? schema.getQueryType() : operation.operation === 'mutation' ? schema.getMutationType() : schema.getSubscriptionType();
const topFields = (operation: OperationDefinitionNode): FieldNode[] =>
  operation.selectionSet.selections.filter((selection): selection is FieldNode => selection.kind === Kind.FIELD && selection.name.value !== '__typename');

function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length]!;
}
function closest(name: string, root: GraphQLObjectType | null | undefined, kind: string): string {
  const candidates = Object.keys(root?.getFields() ?? {}).filter((field) => field !== 'no_queries_available');
  if (!candidates.length) return `the page has no ${kind} fields`;
  const ranked = candidates.map((field) => ({ field, d: distance(name, field) })).sort((a, b) => a.d - b.d || a.field.localeCompare(b.field));
  return `closest: ${ranked.slice(0, CLOSEST).map((entry) => entry.field).join(', ')}`;
}

interface Unknown { name: string; operation: OperationDefinitionNode }
/** Unknown root fields and own-name types as lines: a rename names its replacement, anything else the closest names. */
function unknownLines(label: string, document: DocumentNode, schema: GraphQLSchema, renames: ReadonlyMap<string, { link: string; page: string }>, unknown: readonly Unknown[]): string[] {
  const types: string[] = [];
  visit(document, { NamedType: (node) => { if (!schema.getType(node.name.value) && renames.has(node.name.value) && !types.includes(node.name.value)) types.push(node.name.value); } });
  const lines: string[] = [], tailed = new Set<string>();
  const tail = (link: string) => {
    if (tailed.has(link)) return '';
    tailed.add(link);
    const mine = types.filter((type) => renames.get(type)!.link === link).map((type) => renames.get(type)!.page);
    return mine.length ? ` (and ${mine.join(', ')})` : '';
  };
  const renamed = (name: string) => { const to = renames.get(name)!; return `${label}: ${name} is not on this page; the dataset is linked as "${to.link}": use ${to.page}`; };
  for (const { name, operation } of unknown) {
    const to = renames.get(name);
    lines.push(to ? renamed(name) + tail(to.link) : `${label}: ${name} is not on this page; ${closest(name, rootOf(schema, operation), operation.operation)}`);
  }
  // A field already right with a type still under the dataset's own name.
  for (const type of types) if (!tailed.has(renames.get(type)!.link)) lines.push(renamed(type));
  return lines;
}

/** A resolver document: the whole of it runs on the page's datasets. */
function documentProblems(label: string, document: DocumentNode, schema: GraphQLSchema, renames: ReadonlyMap<string, { link: string; page: string }>): string[] {
  const unknown: Unknown[] = [];
  for (const operation of document.definitions) {
    if (operation.kind !== Kind.OPERATION_DEFINITION) continue;
    const fields = rootOf(schema, operation)?.getFields() ?? {};
    for (const field of topFields(operation)) if (!Object.hasOwn(fields, field.name.value)) unknown.push({ name: field.name.value, operation });
  }
  const lines = unknownLines(label, document, schema, renames, unknown);
  if (lines.length) return lines;
  return validate(schema, document).slice(0, PER_DOCUMENT).map((error) => `${label}: ${error.message}`);
}

/** The client's rule for a remote top-level field (lib/html-runtime/apollo `isBackend`), and whether its schema is in hand. */
function remoteRule(check: PageDocumentCheck): (name: string) => 'local' | 'checked' | 'unchecked' {
  const backends = new Set(check.backends.map((backend) => backend.name)), unchecked = new Set(check.unchecked ?? []);
  const datasets = check.datasets.map((dataset) => dataset.name);
  return (name) => {
    if (unchecked.has(name)) return 'unchecked';
    if (name === PAGE_VIEWER_ROOT || name === PAGE_SQL_ROOT || backends.has(name)) return 'checked';
    const bare = name.replace(/^(?:insert|update|delete)_/, '');
    return datasets.some((link) => bare === link || bare.startsWith(`${link}_`) || name === link || name.startsWith(`${link}_`)) ? 'checked' : 'local';
  };
}

const PAGE_RULES = specifiedRules.filter((rule) => rule !== NoUnusedVariablesRule && rule !== NoUnusedFragmentsRule);

/** A page document: its remote fields only, as the client sends them; local state is never checked. */
function pageProblems(document: DocumentNode, schema: GraphQLSchema, renames: ReadonlyMap<string, { link: string; page: string }>, remote: (name: string) => 'local' | 'checked' | 'unchecked', localMutations: boolean): string[] {
  const label = 'page', unknown: Unknown[] = [];
  const definitions = document.definitions.flatMap((definition): DefinitionNode[] => {
    if (definition.kind !== Kind.OPERATION_DEFINITION) return [definition];
    const fields = rootOf(schema, definition)?.getFields() ?? {};
    const sent = topFields(definition).filter((field) => {
      const name = field.name.value, kind = remote(name);
      if (kind === 'local') {
        // A dataset's own name that cannot be local state: arguments in a query, or a mutation with no local ones.
        const cannotBeLocal = definition.operation === 'query' ? !!field.arguments?.length : definition.operation === 'mutation' && !localMutations;
        if (renames.has(name) && cannotBeLocal) unknown.push({ name, operation: definition });
        return false;
      }
      if (kind === 'unchecked') return false;
      if (!Object.hasOwn(fields, name)) { unknown.push({ name, operation: definition }); return false; }
      return true;
    });
    if (!sent.length) return [];
    // Only the variables the sent fields use (a local field's may name a type the page schema lacks).
    const used = new Set<string>();
    for (const field of sent) visit(field, { Variable: (node) => { used.add(node.name.value); } });
    const variableDefinitions = (definition.variableDefinitions ?? []).filter((v) => used.has(v.variable.name.value));
    return [{ ...definition, selectionSet: { ...definition.selectionSet, selections: sent }, variableDefinitions }];
  });
  const lines = unknownLines(label, document, schema, renames, unknown);
  if (lines.length) return lines;
  if (!definitions.some((definition) => definition.kind === Kind.OPERATION_DEFINITION)) return [];
  return validate(schema, { ...document, definitions }, PAGE_RULES).slice(0, PER_DOCUMENT).map((error) => `${label}: ${error.message}`);
}
