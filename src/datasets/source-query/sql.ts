import { createHash } from "node:crypto";
import type { MigrationSourceQueryRegistration } from "./contracts.ts";
const fail = (): never => {
  throw Error("Invalid source query registration");
};
/** PostgreSQL lexical boundary: literals/comments/identifiers/dollar quotes cannot become parameters. */
export function prepareSourceSql(sql: string): {
  text: string;
  names: string[];
} {
  if (
    typeof sql !== "string" ||
    !sql.trim() ||
    sql.length > 131072 ||
    sql.includes("\0")
  )
    fail();
  let text = "",
    i = 0;
  const names: string[] = [];
  while (i < sql.length) {
    const start = i,
      c = sql[i];
    if (c === "'" || c === '"') {
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] === c) {
          if (sql[i] === c) i++;
          else {
            closed = true;
            break;
          }
        }
      }
      if (!closed) fail();
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? sql.length : end + 1;
    } else if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) fail();
    } else if (c === "$") {
      const quote = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i))?.[0];
      if (quote) {
        const end = sql.indexOf(quote, i + quote.length);
        if (end < 0) fail();
        i = end + quote.length;
      } else {
        const token = /^\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)/.exec(sql.slice(i));
        if (!token) throw Error("Invalid source parameter");
        const name = token[1] === "_me.id" ? "_me__id" : token[1]!;
        if (name.includes(".")) fail();
        let index = names.indexOf(name);
        if (index < 0) {
          index = names.length;
          names.push(name);
        }
        text += "$" + (index + 1);
        i += token[0].length;
        continue;
      }
    } else i++;
    text += sql.slice(start, i);
  }
  return { text: text.trim().replace(/;\s*$/, ""), names };
}
export function validateSourceRegistration(
  r: MigrationSourceQueryRegistration,
): void {
  const types = ["string", "number", "boolean", "date", "timestamp", "user"];
  if (
    !r ||
    typeof r.name !== "string" ||
    !/^[A-Za-z_]\w{0,127}$/.test(r.name) ||
    ["constructor", "prototype", "__proto__"].includes(r.name) ||
    typeof r.sourceRef !== "string" ||
    !/^ref:[A-Za-z0-9]{6,128}$/.test(r.sourceRef) ||
    typeof r.resource !== "string" ||
    !/^source-[A-Za-z0-9]{6,128}$/.test(r.resource) ||
    !Number.isSafeInteger(r.pageVersion) ||
    r.pageVersion < 1 ||
    typeof r.pageLegacyId !== "string" ||
    !r.pageLegacyId ||
    createHash("sha256").update(r.sql).digest("hex") !== r.sqlSha256 ||
    !r.params ||
    Array.isArray(r.params) ||
    Object.values(r.params).some((t) => !types.includes(t)) ||
    !Array.isArray(r.columns) ||
    !r.columns.length ||
    r.columns.length > 256 ||
    r.columns.some(
      (c) =>
        !c ||
        typeof c.name !== "string" ||
        !c.name ||
        c.name.length > 256 ||
        !types.includes(c.type),
    ) ||
    new Set(r.columns.map((c) => c.name)).size !== r.columns.length
  )
    fail();
  if (
    (r.executionSql === undefined) !== (r.executionSqlSha256 === undefined) ||
    (r.executionSql !== undefined &&
      createHash("sha256").update(r.executionSql).digest("hex") !==
        r.executionSqlSha256)
  )
    fail();
  const keys = Object.keys(r.params).sort().join("\0");
  for (const text of [
    r.sql,
    ...(r.executionSql === undefined ? [] : [r.executionSql]),
  ])
    if (prepareSourceSql(text).names.sort().join("\0") !== keys) fail();
}
