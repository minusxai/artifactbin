import { createHash } from "node:crypto";
import type {
  LegacyDuckSqlAdmission,
  LegacyDuckSqlNormalization,
} from "./duck-sql-contracts.ts";
interface Token {
  text: string;
  start: number;
  end: number;
  word: boolean;
}
function tokens(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const start = i,
      c = sql[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw Error("Unclosed legacy SQL comment");
      i = end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] === c) {
          if (sql[i] === c) {
            i++;
            continue;
          }
          closed = true;
          break;
        }
      }
      if (!closed) throw Error("Unclosed legacy SQL quote");
      out.push({ text: sql.slice(start, i), start, end: i, word: false });
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
    if (word) i += word[0].length;
    else i++;
    out.push({ text: sql.slice(start, i), start, end: i, word: !!word });
  }
  return out;
}
const lower = (t: Token | undefined) =>
  t?.word ? t.text.toLowerCase() : t?.text;
function match(ts: Token[], start: number, open = "(", close = ")"): number {
  let depth = 0;
  for (let i = start; i < ts.length; i++) {
    if (ts[i]!.text === open) depth++;
    else if (ts[i]!.text === close && !--depth) return i;
  }
  throw Error("Unbalanced legacy SQL expression");
}
function split(ts: Token[], start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  let from = start,
    depth = 0;
  for (let i = start; i < end; i++) {
    const t = ts[i]!.text;
    if (t === "(" || t === "[") depth++;
    if (t === ")" || t === "]") depth--;
    if (t === "," && !depth) {
      out.push([from, i]);
      from = i + 1;
    }
  }
  out.push([from, end]);
  return out;
}
/** Only the single observed SELECT-level list expansion shape is lowered. A join keeps each
 * source row and list element in input order; qualification avoids json_each's own id column. */
function lowerUnnest(
  sql: string,
  isList: (expression: string) => boolean,
): string {
  const ts = tokens(sql);
  if (!ts.some((t) => lower(t) === "unnest")) return sql;
  let depth = 0,
    select = -1,
    from = -1,
    where = -1;
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]!.text;
    if (t === "(") depth++;
    if (t === ")") depth--;
    if (!depth) {
      if (lower(ts[i]) === "select") select = i;
      else if (lower(ts[i]) === "from" && select >= 0) from = i;
      else if (lower(ts[i]) === "where" && from >= 0) where = i;
    }
  }
  if (select < 0 || from < 0 || where < 0)
    throw Error("Unsupported legacy unnest shape");
  const parts = split(ts, select + 1, from);
  if (parts.length !== 3) throw Error("Unsupported legacy unnest projection");
  const a = ts.slice(...parts[0]!),
    b = ts.slice(...parts[1]!),
    c = ts.slice(...parts[2]!);
  const tail = ts.slice(where + 1);
  if (
    a.length !== 1 ||
    !a[0]!.word ||
    b.length !== 6 ||
    lower(b[0]) !== "unnest" ||
    b[1]!.text !== "(" ||
    !b[2]!.word ||
    b[3]!.text !== ")" ||
    lower(b[4]) !== "as" ||
    !b[5]!.word ||
    c.length !== 8 ||
    !c[0]!.word ||
    c[1]!.text !== "/" ||
    lower(c[2]) !== "len" ||
    c[3]!.text !== "(" ||
    c[4]!.text !== b[2]!.text ||
    c[5]!.text !== ")" ||
    lower(c[6]) !== "as" ||
    !c[7]!.word ||
    where !== from + 2 ||
    !ts[from + 1]!.word ||
    tail.length !== 6 ||
    lower(tail[0]) !== "len" ||
    tail[1]!.text !== "(" ||
    tail[2]!.text !== b[2]!.text ||
    tail[3]!.text !== ")" ||
    tail[4]!.text !== ">" ||
    tail[5]!.text !== "0"
  )
    throw Error("Unsupported legacy unnest shape");
  if (!isList(b[2]!.text))
    throw Error("Legacy unnest requires audited list type");
  const used = new Set(
    ts.filter((t) => t.word).map((t) => t.text.toLowerCase()),
  );
  let n = 0;
  while (used.has("legacylistrow" + n) || used.has("legacylistitem" + n)) n++;
  const row = "legacyListRow" + n,
    item = "legacyListItem" + n,
    list = row + "." + b[2]!.text;
  return (
    sql.slice(0, ts[select]!.start) +
    `select ${row}.${a[0]!.text}, ${item}.value as ${b[5]!.text}, ${row}.${c[0]!.text} * 1.0 / len(${list}) as ${c[7]!.text} from ${ts[from + 1]!.text} as ${row} cross join json_each(${list}) as ${item} where len(${list}) > 0`
  );
}
export function normalizeLegacyDuckSql(
  original: string,
  admissions: readonly LegacyDuckSqlAdmission[] = [],
): LegacyDuckSqlNormalization {
  const digest = createHash("sha256").update(original).digest("hex");
  const admission = admissions.find(
    (a) => a.version === "duckdb-list-v1" && a.sqlSha256 === digest,
  );
  const key = (expression: string) =>
    tokens(expression)
      .map((t) => (t.word ? t.text.toLowerCase() : t.text))
      .join("");
  const lists = new Set((admission?.listExpressions ?? []).map(key));
  const numbers = new Set((admission?.numericExpressions ?? []).map(key));
  const isList = (expression: string) =>
    lists.has(key(expression)) ||
    (/^legacylistrow\d+\./.test(key(expression)) &&
      lists.has(key(expression).replace(/^legacylistrow\d+\./, ""))) ||
    /^cast\([\s\S]*asvarchar\[\]\)$/.test(key(expression)) ||
    /^list\([\s\S]*\)$/.test(key(expression)) ||
    /^to_json\(\[[\s\S]*\]\)$/.test(key(expression));
  const isNumber = (expression: string) =>
    numbers.has(key(expression)) ||
    /^(?:null|[-+]?\d+(?:\.\d+)?)$/i.test(expression.trim());
  const sql = lowerUnnest(original, isList),
    ts = tokens(sql);
  function render(start: number, end: number): string {
    if (start >= end) return "";
    let out = "",
      cursor = ts[start]!.start;
    for (let i = start; i < end; i++) {
      const t = ts[i]!,
        name = lower(t);
      if (t.word && ts[i + 1]?.text === "(") {
        const close = match(ts, i + 1);
        if (close >= end) throw Error("Invalid legacy SQL nesting");
        const args = split(ts, i + 2, close);
        let replacement: string | undefined;
        if (name === "cast") {
          let depth = 0,
            as = -1;
          for (let j = i + 2; j < close; j++) {
            if (ts[j]!.text === "(") depth++;
            else if (ts[j]!.text === ")") depth--;
            else if (!depth && lower(ts[j]) === "as") as = j;
          }
          if (as < 0) throw Error("Invalid legacy cast");
          const type = ts
            .slice(as + 1, close)
            .map((t) => lower(t))
            .join("");
          if (type === "varchar[]") {
            const value = render(i + 2, as);
            replacement = `(case when (${value}) is null then null else (select json_group_array(case when legacyListCast.value is null then null when legacyListCast.type='true' then 'true' when legacyListCast.type='false' then 'false' else cast(legacyListCast.value as text) end) from json_each(to_list(${value})) as legacyListCast) end)`;
          } else if (type.includes("[") || type.includes("]"))
            throw Error("Unsupported legacy list cast");
        }
        const values = () => args.map(([a, b]) => render(a, b));
        if (name === "list") {
          const v = values();
          if (v.length !== 1) throw Error("Unsupported legacy list aggregate");
          replacement = `(case when count(*)=0 then null else json_group_array(${v[0]}) end)`;
        }
        if (name === "len") {
          const raw = args.map(([a, b]) =>
            sql.slice(ts[a]!.start, ts[b - 1]!.end),
          );
          const v = values();
          if (v.length !== 1 || !isList(raw[0]!))
            throw Error("Legacy len requires proven or audited list type");
          replacement = `json_array_length(${v[0]})`;
        }
        if (name === "array_to_string") {
          const v = values();
          if (v.length !== 2) throw Error("Unsupported legacy list join");
          replacement = `(case when (${v[0]}) is null or (${v[1]}) is null then null when json_array_length(${v[0]})=0 then '' else (select group_concat(legacyListJoin.value,${v[1]}) from json_each(${v[0]}) as legacyListJoin) end)`;
        }
        if (name === "least" || name === "greatest") {
          const v = values();
          if (
            v.length < 2 ||
            args.some(
              ([a, b]) => !isNumber(sql.slice(ts[a]!.start, ts[b - 1]!.end)),
            )
          )
            throw Error("Unsupported legacy minimum/maximum");
          replacement = `(select ${name === "least" ? "min" : "max"}(legacyExtremum.value) from (${v.map((v, j) => `select ${v}${j === 0 ? " as value" : ""}`).join(" union all ")}) as legacyExtremum)`;
        }
        if (name === "to_json") {
          const first = ts[i + 2],
            last = ts[close - 1];
          if (args.length !== 1 || first?.text !== "[" || last?.text !== "]")
            throw Error("Unsupported legacy JSON conversion");
          replacement = `json_array(${split(ts, i + 3, close - 1)
            .filter(([a, b]) => a < b)
            .map(([a, b]) => render(a, b))
            .join(",")})`;
        }
        if (replacement !== undefined) {
          out += sql.slice(cursor, t.start) + replacement;
          cursor = ts[close]!.end;
          i = close;
          continue;
        }
        // Recurse through unmodified function calls so nested observed expressions still lower.
        out +=
          sql.slice(cursor, t.start) +
          t.text +
          "(" +
          render(i + 2, close) +
          ")";
        cursor = ts[close]!.end;
        i = close;
      } else if (t.text === "[" || t.text === "]")
        throw Error("Unsupported legacy list expression");
    }
    return out + sql.slice(cursor, ts[end - 1]!.end);
  }
  const lowered = ts.length
    ? sql.slice(0, ts[0]!.start) +
      render(0, ts.length) +
      sql.slice(ts.at(-1)!.end)
    : sql;
  return { sql: lowered, changed: lowered !== original };
}
