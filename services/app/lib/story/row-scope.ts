/** Pure grammar and substitution for DataTable's invocation-local row scope. */
import type { JsxNode } from '@/lib/jsx';

const ROW_REF = /^\$_row\.([A-Za-z_]\w*)$/;
const ROW_TEMPLATE = /\{\s*\$_row\.([A-Za-z_]\w*)\s*\}/g;
export const isReservedName = (name: string): boolean => name.startsWith('_');
export const parseRowRef = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return ROW_REF.exec(value)?.[1] ?? null;
};

export function substituteRow<T>(value: T, row: Record<string, unknown>): T {
  if (typeof value !== 'string') return value;
  const exact = parseRowRef(value);
  if (exact) return (row[exact] ?? null) as T;
  return value.replace(ROW_TEMPLATE, (_all, field: string) => String(row[field] ?? '')) as T;
}

export function rowRefsIn(nodes: JsxNode[]): string[] {
  const found: string[] = [];
  const add = (name: string) => { if (!found.includes(name)) found.push(name); };
  const visit = (node: JsxNode) => {
    if (node.type === 'expression') {
      const match = /^\s*\$_row\.([A-Za-z_]\w*)\s*$/.exec(node.source);
      if (match) add(match[1]);
      return;
    }
    if (node.type === 'text') {
      for (const m of node.value.matchAll(ROW_TEMPLATE)) add(m[1]);
      return;
    }
    for (const attr of node.attributes) if (attr.value.static) {
      const exact = parseRowRef(attr.value.json);
      if (exact) add(exact);
      if (typeof attr.value.json === 'string') for (const m of attr.value.json.matchAll(ROW_TEMPLATE)) add(m[1]);
    }
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return found;
}

/** Replace SQL literals/comments with whitespace, preserving real parameter tokens. */
export function sqlCode(sql: string): string {
  let out = '', i = 0;
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith('--', i)) { while (i < sql.length && sql[i] !== '\n') i++; }
    else if (sql.startsWith('/*', i)) {
      i += 2; let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++];
      while (i < sql.length) { if (sql[i++] === quote) { if (sql[i] === quote) i++; else break; } }
    } else {
      const dollar = sql[i] === '$' ? /^(?:\$\$|\$[A-Za-z_]\w*\$)/.exec(sql.slice(i))?.[0] : null;
      if (dollar) { const end = sql.indexOf(dollar, i + dollar.length); i = end < 0 ? sql.length : end + dollar.length; }
      else { out += sql[i++]; continue; }
    }
    out += ' '.repeat(i - start);
  }
  return out;
}

export function rowFieldsInSql(sql: string): string[] {
  return [...new Set([...sqlCode(sql).matchAll(/(?<![\w$])\$_row\.([A-Za-z_]\w*)/g)].map((m) => m[1]))];
}
export const mutationUsesRow = (sql: string): boolean => /(?<![\w$])\$_(?:row|value)\b/.test(sqlCode(sql));

/** Each editable invocation belongs to a declared table; no SQL authorization is inferred. */
export function analyzeRowScopes(nodes: JsxNode[], columns?: Record<string, import('@artifactbin/contracts').DatasetColumn[]>) {
  const errors: string[] = [];
  const mutationTables: Record<string, string[]> = {};
  const attr = (n: Extract<JsxNode, {type:'element'}>, name: string): unknown => { const a = n.attributes.find((a) => a.name === name); return a?.value.static ? a.value.json : undefined; };
  const ref = (v: unknown) => typeof v === 'string' ? /^\$([A-Za-z_]\w*)$/.exec(v)?.[1] : undefined;
  type Scope = { table: string; key: unknown };
  const visit = (node: JsxNode, scope?: Scope, inColumn = false, parent?: string) => {
    if (node.type !== 'element') {
      if (!inColumn && rowRefsIn([node]).length) errors.push('$_row references belong inside a DataTable Column');
      if (inColumn && scope && columns?.[scope.table]) for (const field of rowRefsIn([node])) {
        if (!columns[scope.table].some((c) => c.name === field)) errors.push(`unknown row field "${field}" in $${scope.table}`);
      }
      return;
    }
    if (node.tag === 'DataTable') {
      const templates = node.children.filter((c) => c.type === 'element' && c.tag === 'Column');
      const table = ref(attr(node, 'data'));
      if (templates.length && attr(node, 'columns') !== undefined) errors.push('DataTable uses either Column children or columns=');
      scope = table ? { table, key: attr(node, 'rowKey') } : undefined;
      inColumn = false;
      const names = new Set<unknown>();
      for (const child of templates) if (child.type === 'element') {
        const col = attr(child, 'col');
        if (typeof col !== 'string' || !/^[A-Za-z_]\w*$/.test(col) || names.has(col)) errors.push('Column col= must name a unique column');
        names.add(col);
        if (columns && table && !columns[table]?.some((c) => c.name === col)) errors.push(`unknown Column "${col}" in $${table}`);
      }
    }
    if (node.tag === 'Column') {
      if (parent !== 'DataTable' || !scope) errors.push('Column must be a direct child of a DataTable bound to a declared table');
      inColumn = parent === 'DataTable' && !!scope;
    }
    const fields = rowRefsIn([{ ...node, children: [] }]);
    if (fields.length && !inColumn) errors.push('$_row references belong inside a DataTable Column');
    if (inColumn && scope && columns?.[scope.table]) for (const field of fields) {
      if (!columns[scope.table].some((c) => c.name === field)) errors.push(`unknown row field "${field}" in $${scope.table}`);
    }
    const run = ref(attr(node, 'run'));
    if (run && inColumn && scope) {
      if (typeof scope.key !== 'string' || !scope.key) errors.push('editable DataTable requires rowKey=');
      else if (columns && !columns[scope.table]?.some((c) => c.name === scope.key)) errors.push(`rowKey "${scope.key}" is absent from $${scope.table}`);
      if (!(mutationTables[run] ??= []).includes(scope.table)) mutationTables[run].push(scope.table);
    }
    for (const child of node.children) visit(child, scope, inColumn, node.tag);
  };
  nodes.forEach((n) => visit(n));
  return { errors, mutationTables };
}
