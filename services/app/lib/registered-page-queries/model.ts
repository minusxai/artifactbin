import type { ColumnType, Scalar } from "@artifactbin/contracts";
import {
  QUERY_LIMITS as limits,
  type QueryPlan,
  type QueryIdentity,
} from "./contracts";
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const name = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,127}$/.test(v);
function typed(v: unknown, type: ColumnType): v is Scalar {
  if (v === null) return true;
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "boolean") return typeof v === "boolean";
  if (typeof v !== "string") return false;
  if (type === "date")
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v
    );
  if (type === "timestamp") return Number.isFinite(Date.parse(v));
  return ["string", "user"].includes(type);
}
export function identityMatches(a: QueryIdentity, b: QueryIdentity) {
  return [
    "pageId",
    "pageVersion",
    "backendId",
    "backendVersion",
    "sourceSha256",
  ].every((k) => a[k as keyof QueryIdentity] === b[k as keyof QueryIdentity]);
}
export function prepare(plan: QueryPlan, request: unknown) {
  if (
    !record(request) ||
    Object.keys(request).some((k) => !["values", "only"].includes(k)) ||
    !record(request.values) ||
    !Array.isArray(request.only) ||
    request.only.length > limits.queries ||
    new Set(request.only).size !== request.only.length ||
    request.only.some((k) => !name(k)) ||
    Buffer.byteLength(JSON.stringify(request)) > limits.inputBytes
  )
    throw Error("invalid_query_request");
  if (
    !Array.isArray(plan.queries) ||
    !Array.isArray(plan.imports) ||
    !record(plan.scalars) ||
    plan.queries.length > limits.queries ||
    plan.imports.length > limits.tables ||
    Object.keys(plan.scalars).length > limits.params
  )
    throw Error("invalid_query_registry");
  const params: Record<string, Scalar> = Object.create(null),
    paramTypes: Record<string, ColumnType> = Object.create(null);
  for (const key of Object.keys(request.values))
    if (!Object.hasOwn(plan.scalars, key)) throw Error("invalid_query_request");
  for (const [key, declaration] of Object.entries(plan.scalars)) {
    if (!name(key) || !typed(declaration.default, declaration.type))
      throw Error("invalid_query_registry");
    const value = Object.hasOwn(request.values, key)
      ? request.values[key]
      : declaration.default;
    if (!typed(value, declaration.type)) throw Error("invalid_query_request");
    params[key] = value;
    paramTypes[key] = declaration.type;
  }
  const map = new Map(plan.queries.map((q) => [q.name, q]));
  if (map.size !== plan.queries.length) throw Error("invalid_query_registry");
  for (const q of plan.queries)
    if (
      !name(q.name) ||
      typeof q.sql !== "string" ||
      Buffer.byteLength(q.sql) > limits.sqlBytes ||
      (q.source!==undefined&&(typeof q.source!=='string'||!q.source||q.source.length>512||q.dependencies?.length!==0)) ||
      !Array.isArray(q.dependencies) ||
      q.dependencies.some((d: unknown) => !name(d))
    )
      throw Error("invalid_query_registry");
  const aliases = new Set<string>();
  for (const relation of plan.imports) {
    if (
      !name(relation.alias) ||
      !name(relation.table) ||
      !relation.binding ||
      aliases.has(relation.alias + "." + relation.table)
    )
      throw Error("invalid_query_registry");
    aliases.add(relation.alias + "." + relation.table);
  }
  const localTables = plan.localTables ?? [];
  const sqlName=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value.toLowerCase());
  const occupied=new Set(['_me',...plan.queries.map(q=>q.name.toLowerCase()),...Object.keys(plan.scalars).map(s=>s.toLowerCase()),...plan.imports.map(i=>i.alias.toLowerCase())]);
  let localRows=0,localCells=0;
  if(!Array.isArray(localTables)||localTables.length+plan.imports.length>limits.tables)throw Error('invalid_query_registry');
  for(const table of localTables){
    if(!record(table)||Object.keys(table).some(k=>!['name','columns','rows'].includes(k))||!sqlName(table.name)||occupied.has(table.name.toLowerCase())||!Array.isArray(table.columns)||!table.columns.length||!Array.isArray(table.rows))throw Error('invalid_query_registry');
    occupied.add(table.name.toLowerCase());
    const columns=new Set<string>();
    for(const column of table.columns){
      if(!record(column)||Object.keys(column).some(k=>!['name','type'].includes(k))||!sqlName(column.name)||columns.has(column.name.toLowerCase())||typeof column.type!=='string'||!['string','number','boolean','date','timestamp','user'].includes(column.type))throw Error('invalid_query_registry');
      columns.add(column.name.toLowerCase());
    }
    const keys=new Set(table.columns.map(c=>c.name));
    for(const row of table.rows)if(!record(row)||Object.keys(row).some(k=>!keys.has(k))||table.columns.some(c=>!typed(row[c.name]??null,c.type)))throw Error('invalid_query_registry');
    localRows+=table.rows.length;localCells+=table.rows.length*table.columns.length;
    if(localRows>limits.rows||localCells>limits.cells)throw Error('query_input_limit');
  }
  if(Buffer.byteLength(JSON.stringify(localTables))>limits.inputBytes)throw Error('query_input_limit');
  const ordered: QueryPlan["queries"][number][] = [],
    visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (key: string) => {
    if (done.has(key)) return;
    const q = map.get(key);
    if (!q || visiting.has(key)) throw Error("invalid_query_registry");
    visiting.add(key);
    for (const dep of q.dependencies) visit(dep);
    visiting.delete(key);
    done.add(key);
    ordered.push(q);
  };
  // Validate the whole immutable program, including queries not selected this invocation.
  for (const q of plan.queries) visit(q.name);
  const needed = new Set<string>();
  const select = (key: string) => {
    if (needed.has(key)) return;
    const q = map.get(key);
    if (!q) throw Error("invalid_query_request");
    needed.add(key);
    q.dependencies.forEach(select);
  };
  (request.only as string[]).forEach(select);
  return {
    params,
    paramTypes,
    localTables: structuredClone(localTables),
    only: [...request.only] as string[],
    queries: ordered
      .filter((q) => needed.has(q.name))
      .map((q) => ({ name: q.name, sql: q.sql,...(q.source?{source:q.source}:{}) })),
  };
}
