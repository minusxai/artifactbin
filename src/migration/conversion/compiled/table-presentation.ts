import type {
  LegacyTablePresentation,
  TablePresentationCompatibility,
} from "./table-presentation-contracts.ts";
/** Mirrors only audited frozen parseColumnSpecs/parseTableHeight compatibility.
 * This is not an alias adapter: key/label entries render no columns in the archive.
 * The caller still validates every retained field against the table capability. */
export function readLegacyTablePresentation(
  attrs: Record<string, unknown>,
): LegacyTablePresentation {
  const compatibility = new Set<TablePresentationCompatibility>();
  const height =
    attrs.height === "auto" || attrs.height === "100%" ? 420 : attrs.height;
  if (height !== attrs.height) compatibility.add("default-table-height");
  let columns = attrs.columns;
  if (Array.isArray(columns) && columns.length > 256)
    throw Error("Table column compatibility limit");
  if (Array.isArray(columns))
    columns = columns.flatMap((entry) => {
      if (
        typeof entry === "string" &&
        entry.length > 0 &&
        entry.length <= 4096
      ) {
        compatibility.add("ignored-column-entry");
        return [];
      }
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const keys = Object.keys(entry);
        if (
          keys.length === 2 &&
          keys.includes("key") &&
          keys.includes("label") &&
          typeof entry.key === "string" &&
          entry.key.length > 0 &&
          entry.key.length <= 4096 &&
          typeof entry.label === "string" &&
          entry.label.length <= 4096
        ) {
          compatibility.add("ignored-column-entry");
          return [];
        }
        if (
          typeof entry.col === "string" &&
          typeof entry.width === "string" &&
          /^\d+(?:\.\d+)?%$/.test(entry.width) &&
          parseFloat(entry.width) > 0 &&
          parseFloat(entry.width) <= 100
        ) {
          compatibility.add("ignored-column-width");
          const { width: _ignored, ...rest } = entry;
          return [rest];
        }
      }
      return [entry];
    });
  return {
    ...(attrs.height === undefined ? {} : { height }),
    ...(columns === undefined
      ? {}
      : { columns: columns as readonly unknown[] }),
    compatibility: [...compatibility],
  };
}
