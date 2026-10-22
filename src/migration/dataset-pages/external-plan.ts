import type { RegisteredExternalDatasetPageSource } from "./contracts.ts";
/** Explicit projection prevents extra operator metadata from reaching HTML. */
export function projectRegisteredExternalDatasetSource(
  source: RegisteredExternalDatasetPageSource,
): RegisteredExternalDatasetPageSource {
  const identifier = (v: unknown) =>
    typeof v === "string" &&
    /^[A-Za-z][A-Za-z0-9_]*$/.test(v) &&
    !["constructor", "prototype", "__proto__"].includes(v);
  const text = (v: unknown) =>
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 128 &&
    !v.includes("\0");
  if (
    source.backendNamespace !== "legacyData" ||
    !/^\/af\/v1\/ids\/[A-Za-z0-9]{6}$/.test(source.backendHref) ||
    !Array.isArray(source.tables) ||
    !source.tables.length ||
    source.tables.length > 64 ||
    new Set(source.tables.map((t) => JSON.stringify([t?.schema, t?.table])))
      .size !== source.tables.length ||
    new Set(source.tables.map((t) => t?.queryName)).size !==
      source.tables.length ||
    source.tables.some(
      (t) =>
        !t ||
        !text(t.schema) ||
        !text(t.table) ||
        !identifier(t.queryName) ||
        !Array.isArray(t.columns) ||
        !t.columns.length ||
        t.columns.length > 256 ||
        new Set(t.columns.map((c: { name: string; type: string }) => c?.name))
          .size !== t.columns.length ||
        t.columns.some(
          (c: { name: string; type: string }) =>
            !c ||
            !text(c.name) ||
            ["constructor", "prototype", "__proto__"].includes(c.name) ||
            ![
              "string",
              "number",
              "boolean",
              "date",
              "timestamp",
              "user",
            ].includes(c.type),
        ),
    )
  )
    throw Error("Invalid standalone external dataset page");
  return {
    kind: "external",
    registered: true,
    backendNamespace: "legacyData",
    backendHref: source.backendHref,
    tables: source.tables.map((t) => ({
      schema: t.schema,
      table: t.table,
      queryName: t.queryName,
      columns: t.columns.map((c: { name: string; type: string }) => ({
        name: c.name,
        type: c.type,
      })),
    })),
  };
}
