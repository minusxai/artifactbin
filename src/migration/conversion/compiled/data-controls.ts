import type {
  CompiledDataControl,
  CompiledDisplayTable,
  CompiledDataControlLimits,
} from "./data-control-contracts.ts";
const reserved = new Set(["constructor", "prototype", "__proto__"]);
const ref = (v: unknown) =>
  typeof v === "string" &&
  /^\$[A-Za-z][A-Za-z0-9_]*$/.test(v) &&
  !reserved.has(v.slice(1));
const text = (v: unknown) => typeof v === "string" && v.length <= 4096;
const scalar = (v: unknown) =>
  v === null ||
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v));
/** Static JSON surface only; unsupported props are never silently dropped by the archived kit. */
export function admitDataControl(
  tag: string,
  attrs: Record<string, unknown>,
  hasChildren = false,
): CompiledDataControl {
  if (hasChildren || !["Select", "DataTable"].includes(tag))
    throw Error("Unsupported data control");
  const allowed =
    tag === "Select"
      ? ["id", "label", "value", "options", "placeholder", "className"]
      : [
          "id",
          "data",
          "rowKey",
          "height",
          "columns",
          "sort",
          "className",
          "transpose",
          "header",
          "metrics",
          "edge",
          "sticky",
        ];
  if (
    Object.keys(attrs).some(
      (k) => !allowed.includes(k) && !/^data-af-(?:id|comment)$/.test(k),
    )
  )
    throw Error("Unsupported data control attribute");
  for (const key of ["id", "label", "placeholder", "className", "rowKey"])
    if (attrs[key] !== undefined && !text(attrs[key]))
      throw Error("Invalid data control text");
  if (tag === "Select") {
    if (!ref(attrs.value)) throw Error("Select requires a declared scalar");
    const options = attrs.options;
    if (
      !ref(options) &&
      !(
        Array.isArray(options) &&
        options.length <= 10000 &&
        options.every(
          (o: any) =>
            scalar(o) ||
            (o &&
              typeof o === "object" &&
              !Array.isArray(o) &&
              Object.keys(o).every((k) => ["value", "label"].includes(k)) &&
              Object.hasOwn(o, "value") &&
              scalar(o.value) &&
              (o.label === undefined || scalar(o.label))),
        )
      )
    )
      throw Error("Select requires finite options");
    return {
      kind: "select",
      value: (attrs.value as string).slice(1),
      options:
        typeof options === "string" ? options.slice(1) : (options as unknown[]),
    };
  }
  for (const key of ["transpose", "edge", "sticky"])
    if (attrs[key] !== undefined && typeof attrs[key] !== "boolean")
      throw Error("Invalid table flag");
  if (
    attrs.transpose !== true &&
    ["header", "metrics", "edge"].some((key) => attrs[key] !== undefined)
  )
    throw Error("Comparison props require transposed table");
  if (attrs.transpose === true) {
    if (attrs.columns !== undefined || attrs.sort !== undefined)
      throw Error("Comparison does not accept sortable columns");
    if (attrs.header !== undefined && (!text(attrs.header) || !attrs.header))
      throw Error("Invalid comparison header");
    const metrics = attrs.metrics;
    if (
      metrics !== undefined &&
      (!Array.isArray(metrics) ||
        metrics.length > 256 ||
        metrics.some(
          (m: any) =>
            !m ||
            typeof m !== "object" ||
            Array.isArray(m) ||
            !text(m.col) ||
            !m.col ||
            Object.keys(m).some(
              (k) =>
                !["col", "title", "fmt", "better", "rank", "sub"].includes(k),
            ) ||
            ["title", "fmt", "rank", "sub"].some(
              (k) => m[k] !== undefined && !text(m[k]),
            ) ||
            (m.better !== undefined && !["high", "low"].includes(m.better)),
        ))
    )
      throw Error("Invalid comparison metrics");
  }
  if (!ref(attrs.data)) throw Error("DataTable requires a declared table");
  if (
    attrs.height !== undefined &&
    !(
      (typeof attrs.height === "number" &&
        Number.isFinite(attrs.height) &&
        attrs.height > 0 &&
        attrs.height <= 10000) ||
      (typeof attrs.height === "string" &&
        /^\s*\d+(?:\.\d+)?\s*(?:px)?\s*$/i.test(attrs.height) &&
        parseFloat(attrs.height) > 0 &&
        parseFloat(attrs.height) <= 10000)
    )
  )
    throw Error("Unsupported table height");
  if (attrs.columns !== undefined) {
    if (
      !Array.isArray(attrs.columns) ||
      attrs.columns.length > 256 ||
      attrs.columns.some(
        (c: any) =>
          !c ||
          typeof c !== "object" ||
          Array.isArray(c) ||
          !text(c.col) ||
          !c.col ||
          Object.keys(c).some(
            (k) =>
              ![
                "col",
                "title",
                "fmt",
                "align",
                "width",
                "bar",
                "colorScale",
              ].includes(k),
          ) ||
          (c.title !== undefined && !text(c.title)) ||
          (c.fmt !== undefined && !text(c.fmt)) ||
          (c.align !== undefined &&
            !["left", "right", "center"].includes(c.align)) ||
          (c.width !== undefined &&
            !(
              typeof c.width === "number" &&
              Number.isFinite(c.width) &&
              c.width > 0 &&
              c.width <= 4096
            )) ||
          (c.bar !== undefined && typeof c.bar !== "boolean") ||
          (c.colorScale !== undefined &&
            !["sequential", "diverging"].includes(c.colorScale)),
      )
    )
      throw Error("Unsupported table columns");
  }
  if (
    attrs.sort !== undefined &&
    !(
      (text(attrs.sort) && !!attrs.sort) ||
      (attrs.sort &&
        typeof attrs.sort === "object" &&
        !Array.isArray(attrs.sort) &&
        Object.keys(attrs.sort).every((k) => ["col", "dir"].includes(k)) &&
        text((attrs.sort as any).col) &&
        ["asc", "desc"].includes((attrs.sort as any).dir))
    )
  )
    throw Error("Unsupported table sort");
  return {
    kind: "table",
    data: (attrs.data as string).slice(1),
    ...(attrs.transpose === true ? { comparison: true as const } : {}),
  };
}
/** Select must never quietly offer only a display window of a larger query. */
export async function completeControlOptions(
  initial: CompiledDisplayTable,
  read: (offset: number, limit: number) => Promise<CompiledDisplayTable>,
  limits: Partial<CompiledDataControlLimits> = {},
): Promise<CompiledDisplayTable> {
  const cap = {
    maxRows: 10000,
    maxBytes: 1024 * 1024,
    pageSize: 500,
    ...limits,
  };
  const deadline = Date.now() + 5000;
  let table = initial,
    rows = [...initial.rows],
    bytes = new TextEncoder().encode(JSON.stringify(initial)).byteLength;
  for (
    let pages = 0;
    table.totalRows !== undefined
      ? rows.length < table.totalRows
      : table.truncated;
    pages++
  ) {
    if (
      Date.now() > deadline ||
      pages > 20 ||
      rows.length >= cap.maxRows ||
      bytes > cap.maxBytes
    )
      throw Error("Select options exceed the supported limit");
    table = await read(rows.length, cap.pageSize);
    if (
      !table ||
      JSON.stringify(table.columns) !== JSON.stringify(initial.columns) ||
      !Array.isArray(table.rows) ||
      !table.rows.length ||
      table.totalRows !== initial.totalRows
    )
      throw Error("Select option snapshot changed");
    rows.push(...table.rows);
    bytes += new TextEncoder().encode(JSON.stringify(table)).byteLength;
  }
  if (
    rows.length > cap.maxRows ||
    bytes > cap.maxBytes ||
    (initial.totalRows !== undefined && rows.length !== initial.totalRows)
  )
    throw Error("Select options exceed the supported limit");
  return { ...initial, rows, truncated: false, totalRows: rows.length };
}

/** Interpret only literal JSON syntax, never execute author expressions. */
export function controlLiteral(node: any): unknown {
  if (node === null) return true;
  if (node?.type === "Literal") return node.value;
  if (node?.type === "JSXExpressionContainer")
    return controlLiteral(node.expression);
  if (node?.type === "ArrayExpression")
    return node.elements.map(controlLiteral);
  if (node?.type === "ObjectExpression") {
    const out: Record<string, unknown> = Object.create(null);
    for (const p of node.properties) {
      if (p.type !== "Property" || p.computed || p.method || p.kind !== "init")
        throw Error("Nonliteral control property");
      const key = p.key.name ?? p.key.value;
      if (
        typeof key !== "string" ||
        reserved.has(key) ||
        Object.hasOwn(out, key)
      )
        throw Error("Invalid control property");
      out[key] = controlLiteral(p.value);
    }
    return out;
  }
  throw Error("Nonliteral control attribute");
}
/** Never pass arbitrary page/sort requests to the offline engine bridge. */
export function controlPageRequest(
  page: any,
  columns: readonly { name: string }[],
) {
  if (
    !page ||
    !Number.isSafeInteger(page.offset) ||
    page.offset < 0 ||
    page.offset > 100000 ||
    !Number.isSafeInteger(page.limit) ||
    page.limit < 1 ||
    page.limit > 500
  )
    throw Error("Unsupported table window");
  if (
    page.sort &&
    (!columns.some((c: any) => c.name === page.sort.col) ||
      !["asc", "desc"].includes(page.sort.dir))
  )
    throw Error("Unsupported table ordering");
  return {
    offset: page.offset,
    limit: page.limit,
    ...(page.sort ? { sort: { col: page.sort.col, dir: page.sort.dir } } : {}),
  };
}
