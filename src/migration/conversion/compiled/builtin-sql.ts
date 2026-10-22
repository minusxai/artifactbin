import type { LegacyBuiltinSql } from "./builtin-sql-contracts.ts";
/** SQLite cannot parse the archived dotted scalar. Skip quoted/comment tokens,
 * rewrite only its canonical spelling, and let prepared parameter metadata prove use. */
export function prepareLegacyBuiltinSql(source: string): LegacyBuiltinSql {
  let sql = "",
    viewerParameter: LegacyBuiltinSql["viewerParameter"] = null;
  for (let i = 0; i < source.length; ) {
    const start = i,
      c = source[i]!;
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      i++;
      while (i < source.length) {
        if (source[i++] === close) {
          if (source[i] === close) i++;
          else break;
        }
      }
    } else if (source.startsWith("--", i) || source.startsWith("/*", i)) {
      const line = source.startsWith("--", i),
        end = source.indexOf(line ? "\n" : "*/", i + 2);
      i = end < 0 ? source.length : end + (line ? 1 : 2);
    } else if (c === "$") {
      const token = /^\$[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/.exec(
        source.slice(i),
      )?.[0];
      if (token === "$_me.id") {
        sql += "$_me__id";
        viewerParameter = "_me__id";
        i += token.length;
        continue;
      }
      i += token?.length ?? 1;
    } else i++;
    sql += source.slice(start, i);
  }
  return { sql, viewerParameter };
}
