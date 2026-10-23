import type { LegacySqlToken } from "./duck-sql-contracts.ts";
/** Deliberately bounded SELECT syntax tree. Source relation/filter text remains intact;
 * only the distinct aggregate projection is moved across the grouping boundary. */
interface GroupedDistinctStringAggregate {
  group: string;
  groupName: string;
  value: string;
  separator: string;
  output: string;
  relation: string;
}
const fail = (): never => {
  throw Error("Unsupported admitted DISTINCT string aggregate shape");
};
const key = (tokens: readonly LegacySqlToken[]) =>
  tokens.map((t) => (t.word ? t.text.toLowerCase() : t.text)).join("");
const identifier = (t: LegacySqlToken | undefined) =>
  Boolean(t?.word && /^[A-Za-z_][A-Za-z_0-9]*$/.test(t.text));
function column(ts: readonly LegacySqlToken[]): boolean {
  return (
    (ts.length === 1 && identifier(ts[0])) ||
    (ts.length === 3 &&
      identifier(ts[0]) &&
      ts[1]?.text === "." &&
      identifier(ts[2]))
  );
}
function parse(
  sql: string,
  ts: readonly LegacySqlToken[],
): GroupedDistinctStringAggregate {
  if (ts.at(-1)?.text === ";") ts = ts.slice(0, -1);
  if (key(ts.slice(0, 1)) !== "select") fail();
  let depth = 0,
    from = -1,
    group = -1;
  const commas: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const t = ts[i]!,
      w = t.word ? t.text.toLowerCase() : t.text;
    if (t.text === "(") depth++;
    if (t.text === ")" && --depth < 0) fail();
    if (depth === 0) {
      if (w === "from" && from < 0) from = i;
      else if (w === "group" && key(ts.slice(i, i + 2)) === "groupby")
        group = i;
      else if (
        [
          "having",
          "order",
          "limit",
          "offset",
          "union",
          "except",
          "intersect",
          "window",
          ";",
        ].includes(w)
      )
        fail();
      if (t.text === "," && from < 0) commas.push(i);
    }
  }
  if (depth !== 0 || from < 0 || group < from || commas.length !== 1) fail();
  const c = commas[0]!,
    groupTokens = ts.slice(1, c);
  if (!column(groupTokens) || key(groupTokens) !== key(ts.slice(group + 2)))
    fail();
  const aggregate = ts.slice(c + 1, from);
  if (key(aggregate.slice(0, 3)) !== "string_agg(distinct") fail();
  let close = -1,
    separator = -1;
  depth = 1;
  for (let i = 3; i < aggregate.length; i++) {
    const t = aggregate[i]!;
    if (t.text === "(") depth++;
    if (t.text === ")" && --depth === 0) {
      close = i;
      break;
    }
    if (t.text === "," && depth === 1) {
      if (separator >= 0) fail();
      separator = i;
    }
  }
  if (separator < 4 || close !== separator + 2) fail();
  const sep = aggregate[separator + 1]!;
  if (sep.word || !/^'(?:[^']|'')*'$/.test(sep.text)) fail();
  const alias = aggregate.slice(close + 1);
  if (
    alias.length !== 1 &&
    !(alias.length === 2 && key(alias.slice(0, 1)) === "as")
  )
    fail();
  if (
    !identifier(alias.at(-1)) ||
    alias.at(-1)!.text.toLowerCase() === groupTokens.at(-1)!.text.toLowerCase()
  )
    fail();
  const valueTokens = aggregate.slice(3, separator);
  // This observed text expression is a column or CASE over columns/literals. No
  // nested SELECT, function/aggregate/window, collation or dynamic separator.
  if (!column(valueTokens)) {
    if (
      key(valueTokens.slice(0, 1)) !== "case" ||
      key(valueTokens.slice(-1)) !== "end"
    )
      fail();
    for (let i = 0; i < valueTokens.length; i++) {
      const t = valueTokens[i]!;
      if (
        t.text === "(" ||
        t.text === ")" ||
        t.text === ";" ||
        ["select", "collate", "over", "filter", "distinct"].includes(
          t.text.toLowerCase(),
        )
      )
        fail();
      if (
        !t.word &&
        !/^'(?:[^']|'')*'$/.test(t.text) &&
        ![
          ".",
          "=",
          "!",
          "<",
          ">",
          "0",
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "-",
          "+",
        ].includes(t.text)
      )
        fail();
    }
  }
  const relationTokens = ts.slice(from + 1, group);
  if (
    !relationTokens.length ||
    relationTokens.some(
      (t) =>
        t.word &&
        [
          "select",
          "with",
          "group",
          "having",
          "order",
          "limit",
          "union",
          "except",
          "intersect",
          "window",
        ].includes(t.text.toLowerCase()),
    )
  )
    fail();
  const span = (a: LegacySqlToken, b: LegacySqlToken) =>
    sql.slice(a.start, b.end);
  return {
    group: span(groupTokens[0]!, groupTokens.at(-1)!),
    groupName: groupTokens.at(-1)!.text,
    value: span(valueTokens[0]!, valueTokens.at(-1)!),
    separator: sep.text,
    output: alias.at(-1)!.text,
    relation: span(ts[from]!, ts[group - 1]!),
  };
}
export function lowerDistinctStringAggregate(
  sql: string,
  ts: readonly LegacySqlToken[],
  admitted: boolean,
): string {
  const has = ts.some(
    (t, i) =>
      t.word &&
      t.text.toLowerCase() === "string_agg" &&
      ts[i + 1]?.text === "(" &&
      ts[i + 2]?.text.toLowerCase() === "distinct",
  );
  if (!has) return sql;
  if (!admitted)
    throw Error("DISTINCT string aggregate requires exact SQL admission");
  const ast = parse(sql, ts),
    used = new Set(ts.filter((t) => t.word).map((t) => t.text.toLowerCase()));
  let n = 0;
  while (
    used.has("legacydistinctvalue" + n) ||
    used.has("legacydistinctgroup" + n)
  )
    n++;
  const v = "legacyDistinctValue" + n,
    g = "legacyDistinctGroup" + n;
  return `select ${g} as ${ast.groupName},group_concat(${v},${ast.separator}) as ${ast.output} from (select distinct ${ast.group} as ${g},${ast.value} as ${v} ${ast.relation}) group by ${g}`;
}
