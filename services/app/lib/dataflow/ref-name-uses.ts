/**
 * THE REFERENCE GRAPH OF THE MARKUP: every `$name` the body reads or writes — bindings in the REF_ATTRS positions,
 * `set=`/`args=` maps, reactive expressions, and templates in strings (lib/jsx/template) — with what kind it must
 * name. `validateDataflow` (./dataflow) and the compiler's column check (./compile-dataflow) judge them.
 *
 * Apart from ./dataflow because the reader islands import that leaf and never ask this: its own file keeps the
 * component registry and the template grammar out of every page's shared runtime (scripts/__tests__/build-islands).
 */
import type { JsxNode } from '@/lib/jsx';
import { reactiveNames, type ReactiveExpression } from '@/lib/jsx/reactive';
import { attributeSignals } from '@/lib/jsx/template';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { READ_ONLY_REF_ATTRS } from './builtins';
import { ARGS_ATTR, bindingMap, isTemplateRefPosition, refName, REF_ATTRS, SET_ATTR, templateRefNames, type RefKind } from './dataflow';

type Span = { start: number; end: number };

/** One `$name` occurrence in the body. */
export interface RefNameUse {
  start: number;
  end: number;
  name: string;
  tag: string;
  attr: string;
  expects: RefKind;
  /** True where the reference is only READ — the positions a built-in (`$_me.id`) may sit in. */
  readOnly?: boolean;
  /** A first-row cell (`{$tiles.cheap_v}`): `name` is the table, this its column, checked once the queries compile. */
  column?: string;
}

/** Every `$name` reference in the BODY, from the REF_ATTRS positions only. */
const REGISTERED_COMPONENT_NAMES: ReadonlySet<string> = new Set(JSX_STORY_COMPONENT_NAMES);
export function collectRefNameUses(body: JsxNode[]): RefNameUse[] {
  const out: RefNameUse[] = [];
  /** One read of the page: a value (or built-in), or a query's first-row cell (`tiles.cheap_v`), which reads a table. */
  const read = (name: string, span: Span, tag: string, attr: string) => {
    const dot = name.indexOf('.');
    if (dot > 0 && !name.startsWith('_')) out.push({name: name.slice(0, dot), column: name.slice(dot + 1), tag, attr, expects: 'table', readOnly: true, start: span.start, end: span.end});
    else out.push({name, tag, attr, expects: 'scalar', readOnly: true, start: span.start, end: span.end});
  };
  const expressionUses = (expression: ReactiveExpression | undefined, span: Span, tag: string, attr: string) => {
    // A reactive expression only reads: `{$_me.id ? … : …}` never writes anything.
    if (expression) for (const name of reactiveNames(expression).signals) read(name, span, tag, attr);
  };
  const visit = (nodes: JsxNode[]) => {
    for (const n of nodes) {
      if (n.type === 'expression' && !n.value.static) expressionUses(n.value.reactive, n, 'expression', 'value');
      if (n.type !== 'element') continue;
      if (n.control && n.control.kind !== 'fragment') expressionUses(n.control.test, n, 'condition', 'test');
      const scriptComponent = n.isComponent && !REGISTERED_COMPONENT_NAMES.has(n.tag);
      if (n.tag === 'FileUpload') {
        const dataset = n.attributes.find(a => a.name === 'dataset');
        if (dataset?.value.static && typeof dataset.value.json === 'string') out.push({name: dataset.value.json, tag:n.tag, attr:'dataset', expects:'any', readOnly:true, start:dataset.start, end:dataset.end});
      }
      for (const a of n.attributes) if (!a.value.static) {
        if(n.tag === 'For' && a.name === 'each' && a.value.reactive?.kind === 'signal') out.push({name:a.value.reactive.name,tag:n.tag,attr:a.name,expects:'table',start:a.start,end:a.end});
        // A script component's prop binds the declared signal, whatever its kind; the runtime hands it over as one.
        else if (scriptComponent && a.value.reactive?.kind === 'signal') out.push({name:a.value.reactive.name,tag:n.tag,attr:a.name,expects:'any',readOnly:true,start:a.start,end:a.end});
        else expressionUses(a.value.reactive, a, n.tag, a.name);
      } else if (scriptComponent && typeof a.value.json === 'string') {
        const name = refName(a.value.json);
        if (name) out.push({name,tag:n.tag,attr:a.name,expects:'any',readOnly:true,start:a.start,end:a.end});
      }
      // A template in a string the reader sees (`title="For {$region}"`, `{$tiles.cheap_v}`, a chart spec) reads like an expression.
      for (const a of n.attributes) if (a.value.static) for (const name of attributeSignals(n.tag, a.name, n.isComponent, a.value.json, scriptComponent)) read(name, a, n.tag, a.name);
      // `set=` WRITES its keys (declared scalar Values) and READS its sources; `args=` only reads.
      for (const a of n.attributes) {
        if ((a.name !== SET_ATTR && a.name !== ARGS_ATTR) || !a.value.static) continue;
        for (const [key, source] of Object.entries(bindingMap(a.value.json) ?? {})) {
          if (a.name === SET_ATTR) out.push({ name: key, tag: n.tag, attr: a.name, expects: 'scalar', start: a.start, end: a.end });
          if ('ref' in source && !source.ref.startsWith('_row.')) out.push({ name: source.ref, tag: n.tag, attr: a.name, expects: 'scalar', readOnly: true, start: a.start, end: a.end });
        }
      }
      const table = n.isComponent ? REF_ATTRS.components[n.tag] : REF_ATTRS.html[n.tag.toLowerCase()];
      if (table) {
        for (const a of n.attributes) {
          const expects = table[n.isComponent ? a.name : a.name.toLowerCase()];
          if (!expects || !a.value.static) continue;
          const readOnly = !!(n.isComponent && READ_ONLY_REF_ATTRS[n.tag]?.has(a.name));
          const name = refName(a.value.json);
          if (name) { out.push({ name, tag: n.tag, attr: a.name, expects, readOnly, start: a.start, end: a.end }); continue; }
          // …and, in the one position that reads it, every `{$name}` inside the
          // string. Same kind, same checks, same refusal — one use per name.
          if (!isTemplateRefPosition(n.tag, a.name, n.isComponent)) continue;
          for (const templated of templateRefNames(a.value.json)) {
            out.push({ name: templated, tag: n.tag, attr: a.name, expects, readOnly, start: a.start, end: a.end });
          }
        }
      }
      visit(n.children);
    }
  };
  visit(body);
  return out;
}

