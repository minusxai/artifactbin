import { createHash } from "node:crypto";
import type { LocalColumnType } from "./local-contracts.ts";
import type {
  SourceQueryExpansion,
  SourceQueryExpansionPorts,
} from "./source-query-contracts.ts";
/** Reverse only real parameter tokens in the archived renderer's SQL, preserving quoted literals/identifiers. */
function namedSql(sql: string, names: readonly string[]): string {
  let out = "",
    i = 0;
  const used = new Set<number>();
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === "'" || c === '"') {
      const start = i++,
        quote = c;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] === quote) {
          if (sql[i] === quote) {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw Error("Invalid expanded SQL quote");
      out += sql.slice(start, i);
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      const stop = end < 0 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw Error("Invalid expanded SQL comment");
      out += sql.slice(start, i);
      continue;
    }
    if (c === "$") {
      const delimiter = /^(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)/.exec(
        sql.slice(i),
      )?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end < 0) throw Error("Invalid expanded SQL dollar quote");
        out += sql.slice(i, end + delimiter.length);
        i = end + delimiter.length;
        continue;
      }
      const token = /^\$(\d+)/.exec(sql.slice(i));
      if (!token) throw Error("Invalid expanded SQL parameter");
      const index = Number(token[1]) - 1;
      if (!Number.isSafeInteger(index) || index < 0 || index >= names.length)
        throw Error("Invalid expanded SQL parameter");
      used.add(index);
      out += "$" + names[index];
      i += token[0].length;
      continue;
    }
    // Consume identifiers so dollars inside them are never interpreted as parameters.
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
    if (word) {
      out += word[0];
      i += word[0].length;
    } else {
      out += c;
      i++;
    }
  }
  if (used.size !== names.length) throw Error("Unused expanded SQL parameter");
  return out;
}
export function expandSourceQuery(
  sql: string,
  declarations: Readonly<
    Record<string, { type: LocalColumnType; default: unknown }>
  >,
  ports: SourceQueryExpansionPorts,
): SourceQueryExpansion {
  const names: string[] = [],
    values: Record<string, unknown> = Object.create(null),
    types: Record<string, LocalColumnType> = Object.create(null);
  for (const [name, d] of Object.entries(declarations)) {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name) || name === "__proto__")
      throw Error("Invalid source parameter");
    types[name] = d.type;
    Object.defineProperty(values, name, {
      enumerable: true,
      get() {
        if (!names.includes(name)) names.push(name);
        return d.default;
      },
    });
  }
  const compiled = ports.compile(sql, values, types);
  if (compiled.values.length !== names.length)
    throw Error("Untracked expanded SQL parameter");
  const executionSql = namedSql(compiled.sql, names),
    params: Record<string, LocalColumnType> = Object.create(null);
  for (const name of names) params[name] = types[name]!;
  return {
    executionSql,
    executionSqlSha256: createHash("sha256").update(executionSql).digest("hex"),
    params,
  };
}
