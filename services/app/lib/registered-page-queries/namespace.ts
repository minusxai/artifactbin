import type {
  HtmlJson,
  HtmlPageVersion,
  PageResolverFieldCall,
} from "@artifactbin/contracts";
import type { QueryContext, QueryPlan, RegisteredViewerDescriptor } from "./contracts";
import { FIELD_ERROR_CODE, FieldFailed } from "@/lib/page-operations";
/** A failed evaluation carries its sanitized reason as the field's error code (e.g. sql_read_rejected). */
const evaluationFailure = (error: unknown) => {
  if (error instanceof FieldFailed) return error;
  const reason = error instanceof Error ? error.message : "";
  return new FieldFailed(FIELD_ERROR_CODE.test(reason) ? reason : "registered_query_failed");
};
/** Schema generated from immutable declarations; no arbitrary JSON/SQL/dataset/builtin input. */
export function registeredQuerySchema(
  program: Pick<QueryPlan, "scalars" | "queries">,
): string {
  const scalars = Object.entries(program.scalars).map(
    ([name, value]) =>
      `${name}: ${value.type === "number" ? "Float" : value.type === "boolean" ? "Boolean" : "String"}`,
  );
  return `${scalars.length ? `input Values { ${scalars.join(" ")} }` : ""}
 enum QueryName { ${program.queries.length ? program.queries.map((q) => q.name).join(" ") : "_NONE"} }
 type Column {name:String! type:String!}
 type Cell {text:String number:Float boolean:Boolean isNull:Boolean!}
 type Row {cells:[Cell!]!}
 type Table {name:String! columns:[Column!]! rows:[Row!]! error:String}
 type Answer {tables:[Table!]!}
 type Viewer {id:String}
 type Query {viewer:Viewer! evaluate(${scalars.length ? "values:Values! " : ""}only:[QueryName!]!):Answer!}`;
}
export function registeredQueryInvoker(
  page: HtmlPageVersion,
  context: QueryContext,
  execute: (
    context: QueryContext,
    args: unknown,
    signal: AbortSignal,
  ) => Promise<Record<string, import("@artifactbin/contracts").QueryOutcome>>,
) {
  return async (call: PageResolverFieldCall): Promise<HtmlJson> => {
    if (
      call.operation !== "query" ||
      !["evaluate", "viewer"].includes(call.field) ||
      call.principal.tenant !== page.pageId ||
      call.principal.subject !== context.subject ||
      call.fileId !== context.backendId ||
      call.version !== context.backendVersion
    )
      throw Error("registered_query_unavailable");
    call.signal.throwIfAborted();
    if (call.field === "viewer") return {id:context.subject};
    const args = { ...call.args, values: call.args.values ?? {} };
    const answer = await execute(context, args, call.signal).catch((error: unknown) => {
      throw evaluationFailure(error);
    });
    return {
      tables: Object.entries(answer).map(([name, outcome]) =>
        "error" in outcome
          ? { name, columns: [], rows: [], error: outcome.error }
          : {
              name,
              columns: outcome.columns.map((column) => ({
                name: column.name,
                type: column.type,
              })),
              rows: outcome.rows.map((row) => ({
                cells: outcome.columns.map((column): HtmlJson => {
                  const value = row[column.name] ?? null;
                  if (value === null) return { isNull: true };
                  if (typeof value === "number")
                    return { isNull: false, number: value };
                  if (typeof value === "boolean")
                    return { isNull: false, boolean: value };
                  if (typeof value === "string")
                    return { isNull: false, text: value };
                  throw Error("invalid_query_output");
                }),
              })),
              error: null,
            },
      ),
    };
  };
}

/** Portable author binding descriptor; carries only the public typed wire contract. */
export function registeredQueryDescriptor(
  namespace: string,
  program: Pick<QueryPlan, "scalars" | "queries">,
  name: string,
) {
  if (
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(namespace) ||
    !program.queries.some((query) => query.name === name)
  )
    throw Error("invalid_query_descriptor");
  const values = Object.entries(program.scalars).map(([name, value]) => ({
    name,
    type: value.type,
  }));
  return {
    name,
    namespace,
    values,
    tableName: name,
    responsePath: [namespace, "evaluate", "tables"] as const,
    decode: "registered-page-table-cells-v1" as const,
    document: `query RegisteredQuery(${values.length ? `$values: ${namespace}__Values!, ` : ""}$only: [${namespace}__QueryName!]!) { ${namespace} { evaluate(${values.length ? "values: $values, " : ""}only: $only) { tables { name error columns { name type } rows { cells { text number boolean } } } } } }`,
  };
}

/** Viewer identity is an explicit remote namespace field, never local page state or credentials. */
export function registeredViewerDescriptor(namespace:string):RegisteredViewerDescriptor {
 if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(namespace))throw Error("invalid_viewer_descriptor");
 return {namespace,identity:"target-subject-v1",document:`query NativeViewer { ${namespace} { viewer { id } } }`,responsePath:[namespace,"viewer","id"]};
}
