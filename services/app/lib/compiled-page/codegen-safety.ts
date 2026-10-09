/**
 * CODEGEN SAFETY, AS A HARNESS (docs/phase2-architecture.md §9).
 *
 * The compiler (compiler.ts) turns a document into JavaScript. The one rule
 * that makes that safe is STRUCTURE INDEPENDENCE: author text may only ever
 * become a string literal, so two documents with the same tree and different
 * strings — benign or hostile — must compile to modules whose ASTs are
 * identical once every literal is blanked. This module is the proof kit:
 *
 *   shapeOf(source)            the module's AST with every string literal, JSX
 *                              text and template chunk blanked — the code's
 *                              structure and nothing else.
 *   HOSTILE_STRINGS            what an attacker would put in text, attributes,
 *                              ids, classes, styles and rows.
 *   hostileDocument(strings)   one parsed document exercising every author-
 *                              string position the compiler emits, with the
 *                              given strings in them.
 *   structureIndependent(...)  compile a benign and a hostile document, compare
 *                              shapes, and check the literal forms: no raw
 *                              `</script`, U+2028/2029 or markup in the module.
 *
 * Ported from the prototype's safety.mjs. Pure; the compiler is passed in, so
 * this lands before it and its tests are the compiler's acceptance tests.
 */
import * as acorn from 'acorn';
import jsx from 'acorn-jsx';
import type { JsxAttribute, JsxNode } from '@/lib/jsx';

const Parser = acorn.Parser.extend(jsx());

/** The module's structure: its AST with every literal blanked and every position dropped. */
export function shapeOf(source: string): string {
  const ast = Parser.parse(source, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Record<string, unknown>;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const n = node as Record<string, unknown>;
    delete n.start; delete n.end; delete n.loc; delete n.range; delete n.raw;
    if (n.type === 'Literal' && typeof n.value === 'string') n.value = '<S>';
    if (n.type === 'JSXText') n.value = '<T>';
    if (n.type === 'TemplateElement') n.value = { raw: '<T>', cooked: '<T>' };
    for (const key of Object.keys(n)) walk(n[key]);
  };
  walk(ast);
  return JSON.stringify(ast);
}

/** U+2028 and U+2029: legal in JSON, line terminators in JavaScript source. Built from code points so this file carries none. */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const LINE_SEPARATORS = LS + PS;

/** Author strings that would be code, markup or a URL scheme if anything but a literal. */
export const HOSTILE_STRINGS: readonly string[] = [
  '</script><script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  "'; alert(1); '",
  '`${alert(1)}`',
  LINE_SEPARATORS,
  '{alert(1)}',
  '<!--',
  ']]>',
  'javascript:alert(1)',
];
/** Nine ordinary strings, one per position `hostileDocument` fills. */
export const BENIGN_STRINGS: readonly string[] = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** Byte sequences that must never appear raw in a generated module. */
const FORBIDDEN_IN_MODULE: readonly string[] = ['</script', LS, PS, 'onerror=alert(1)>'];

const text = (value: string): JsxNode => ({ type: 'text', value, start: 0, end: 0 });
const literal = (json: unknown) => ({ static: true as const, json });
const attr = (name: string, json: unknown): JsxAttribute => ({ name, value: literal(json), start: 0, end: 0 } as JsxAttribute);
const element = (tag: string, attributes: JsxAttribute[], children: JsxNode[] = []): JsxNode =>
  ({ type: 'element', tag, isComponent: /^[A-Z]/.test(tag), attributes, children, selfClosing: !children.length, start: 0, end: 0 } as JsxNode);
const reactive = (source: string, reactive: unknown, exprType: string) => ({ static: false as const, exprType, source, reactive });

/** What the compiler is handed for one version: the parsed nodes and the version-owned facts (CompileInput minus the build). */
interface SafetyDocument {
  nodes: JsxNode[];
  colorMode: 'light' | 'dark';
  template: null;
  chrome: false;
  refData: Record<string, never>;
  flow: null;
}

/**
 * One document exercising every author-string position: text, an expression,
 * an attribute value, an id, a class, a style, a component's api prop, a
 * tabs value, and a `<For>` whose rows carry the strings (substituted at
 * runtime) and a dangerous-scheme href.
 */
export function hostileDocument(strings: readonly string[]): SafetyDocument {
  const [x0 = '', x1 = '', x2 = '', x3 = '', x4 = '', x5 = '', x6 = '', x7 = '', x8 = ''] = strings;
  return {
    nodes: [
      element('Helmet', [], [element('Value', [attr('name', 'rows'), attr('type', 'table'), attr('value', [{ k: 'a', label: x0, url: 'javascript:alert(1)' }, { k: 'b', label: x1, url: 'https://ok.example/?q=' + x2 }])])]),
      element('div', [attr('id', 'root'), attr('className', x3), attr('title', x4), attr('data-note', x5), attr('style', 'color: red; --x: ' + x2)], [
        text(x0),
        element('p', [attr('id', 'p1')], [text(x1), { type: 'expression', value: literal(x2), source: '', start: 0, end: 0 } as JsxNode]),
        element('Badge', [attr('id', 'b1'), attr('className', x4)], [text(x5)]),
        element('span', [attr('id', 's2'), attr('data-c', x6), attr('aria-label', x7)], [text(x8)]),
        element('Tabs', [attr('defaultValue', x0), attr('id', 'tabs')], [element('TabsList', [], [element('TabsTrigger', [attr('value', x0)], [text(x1)])]), element('TabsContent', [attr('value', x0)], [text(x3)])]),
        element('ul', [attr('id', 'list')], [element('For', [attr('id', 'rowsFor'), { name: 'each', value: reactive('$rows', { kind: 'signal', name: 'rows' }, 'Identifier'), start: 0, end: 0 } as JsxAttribute, attr('keyBy', 'k')], [
          element('li', [attr('id', 'li')], [element('a', [attr('id', 'lnk'), attr('href', '$_row.url')], [{ type: 'expression', value: reactive('$_row.label', { kind: 'row', field: 'label' }, 'MemberExpression'), source: '$_row.label', start: 0, end: 0 } as JsxNode])]),
        ])]),
      ]),
    ],
    colorMode: 'light', template: null, chrome: false, refData: {}, flow: null,
  };
}

/** A document with a handler attribute and a malformed attribute name: neither may reach the module. */
export function namedHazardsDocument(): SafetyDocument {
  return { nodes: [element('div', [attr('onclick', 'alert(1)'), attr('data-x" onmouseover="alert(1)', 'z'), attr('id', 'n')])], colorMode: 'light', template: null, chrome: false, refData: {}, flow: null };
}
/** A document whose tag name is outside the grammar: the compile must refuse it. */
export function malformedTagDocument(): SafetyDocument {
  return { nodes: [element('div><script', [])], colorMode: 'light', template: null, chrome: false, refData: {}, flow: null };
}

/** The generated sources a compile yields (the compiler's `sources`): the skeleton and the islands module. */
export interface GeneratedSources { skeleton: string; islands: string }

interface StructureVerdict {
  /** The skeleton's shape is the same for benign and hostile strings. */
  skeletonIndependent: boolean;
  islandsIndependent: boolean;
  /** Forbidden byte sequences found raw in the hostile modules, by name. */
  leaked: string[];
}

/** Compile both documents and judge: identical shapes, and nothing forbidden in the hostile module's bytes. */
export async function structureIndependent(compile: (doc: SafetyDocument) => Promise<GeneratedSources> | GeneratedSources): Promise<StructureVerdict> {
  const benign = await compile(hostileDocument(BENIGN_STRINGS));
  const hostile = await compile(hostileDocument(HOSTILE_STRINGS));
  const leaked = FORBIDDEN_IN_MODULE.filter((bad) => hostile.skeleton.includes(bad) || hostile.islands.includes(bad));
  return {
    skeletonIndependent: shapeOf(benign.skeleton) === shapeOf(hostile.skeleton),
    islandsIndependent: shapeOf(benign.islands) === shapeOf(hostile.islands),
    leaked,
  };
}
