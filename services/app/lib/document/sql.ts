/** Native JSONB expressions. Consecutive edits to one node reconstruct the document once.
 * A failed guard removes the result row, so the caller cannot commit a partial batch.
 * The caller supplies a CTE named `input` with a `document` column and joins our result.
 */
import type {DocumentPrimitive} from '@artifactbin/contracts';
import {assertPrimitive, DocumentError} from './model';

export function compileDocumentOperations(operations: DocumentPrimitive[], initialParams: unknown[] = []): {ctes: string; result: string; params: unknown[]} {
 if (!operations.length || operations.length > 500) throw new DocumentError('Expected 1–500 operations');
 const params = [...initialParams];
 const bind = (value: unknown, type: string): string => {params.push(value);return `$${params.length}::${type}`;};
 const steps: string[] = [];
 let previous = 'input', serial = 0;
 function stage(select: string): string {const name = `doc_step_${serial++}`;steps.push(`${name} AS MATERIALIZED (${select})`);return name;}
 for (let i = 0; i < operations.length;) {
  const op = operations[i]!;assertPrimitive(op);
  if (op.kind === 'addNodes' || op.kind === 'removeNodes') {
   const ids = bind(op.kind === 'addNodes' ? Object.keys(op.nodes) : op.ids, 'text[]');
   const guard = op.kind === 'addNodes' ? `NOT (document->'nodes' ?| ${ids})` : `(document->'nodes' ?& ${ids}) AND NOT (document->>'rootId' = ANY(${ids}))`;
   const nodes = op.kind === 'addNodes' ? `(document->'nodes') || ${bind(JSON.stringify(op.nodes), 'jsonb')}` : `(document->'nodes') - ${ids}`;
   previous = stage(`SELECT jsonb_set(document, '{nodes}', ${nodes}, false) AS document FROM ${previous} WHERE ${guard}`);
   i++;continue;
  }
  const nodeId = op.nodeId;
  const nodePath = bind(['nodes', nodeId], 'text[]');
  let local = stage(`SELECT document, document #> ${nodePath} AS node FROM ${previous} WHERE jsonb_typeof(document #> ${nodePath}) = 'object'`);
  while (i < operations.length) {
   const item = operations[i]!;assertPrimitive(item);
   if (!('nodeId' in item) || item.nodeId !== nodeId) break;
   const path = bind(item.path, 'text[]');
   const parent = item.kind === 'set' || item.kind === 'unset' ? bind(item.path.slice(0,-1), 'text[]') : '';
   const key = item.path.at(-1)!;
   const value = `node #> ${path}`, container = `node #> ${parent}`;
   let guard: string, expression: string;
   if (item.kind === 'set') {
    // jsonb_set silently ignores missing ancestors; make that an explicit rejection.
    const arrayIndex = /^(0|[1-9][0-9]*)$/.test(key) && Number.isSafeInteger(Number(key)) ? Number(key) : null;
    guard = `CASE jsonb_typeof(${container}) WHEN 'object' THEN true WHEN 'array' THEN ${arrayIndex === null ? 'false' : `${arrayIndex} < jsonb_array_length(${container})`} ELSE false END`;
    expression = `jsonb_set(node, ${path}, ${bind(JSON.stringify(item.value),'jsonb')}, true)`;
   } else if (item.kind === 'unset') {
    guard = `jsonb_typeof(${container}) = 'object' AND (${value}) IS NOT NULL`;
    expression = `node #- ${path}`;
   } else if (item.kind === 'text') {
    const start = bind(item.start,'integer'), count = bind(item.deleteCount,'integer'), text = bind(item.text,'text');
    guard = `jsonb_typeof(${value}) = 'string' AND ${start}::bigint + ${count}::bigint <= char_length(node #>> ${path})`;
    expression = `jsonb_set(node, ${path}, to_jsonb(overlay(node #>> ${path} placing ${text} from (${start} + 1) for ${count})), false)`;
   } else {
    const index = bind(item.index,'integer');
    guard = `CASE WHEN jsonb_typeof(${value}) = 'array' THEN ${index} ${item.kind === 'insert' ? '<=' : '<'} jsonb_array_length(${value}) ELSE false END`;
    const indexed = bind([...item.path,String(item.index)],'text[]');
    expression = item.kind === 'insert' ? `jsonb_insert(node, ${indexed}, ${bind(JSON.stringify(item.value),'jsonb')}, false)` : `node #- ${indexed}`;
   }
   // CASE prevents an invalid expression from throwing even if the planner evaluates it early.
   local = stage(`SELECT document, CASE WHEN ${guard} THEN ${expression} END AS node FROM ${local} WHERE ${guard}`);
   i++;
  }
  previous = stage(`SELECT jsonb_set(document, ${nodePath}, node, false) AS document FROM ${local} WHERE node IS NOT NULL`);
 }
 return {ctes: steps.join(',\n'), result: previous, params};
}
