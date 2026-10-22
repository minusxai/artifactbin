import type {
  DatasetBinding,
  DatasetCallContext,
} from "../datasets/contracts.ts";
/** Binding routing columns and immutable catalog are authoritative, never the caller's descriptor. */
export function decodeDatasetBinding(
  row: Record<string, unknown>,
  context: DatasetCallContext,
  name: string,
): DatasetBinding | null {
  const descriptor = row.descriptor as Omit<DatasetBinding, "tables">;
  if (
    !descriptor ||
    descriptor.name !== name ||
    descriptor.backendId !== context.backendId ||
    descriptor.backendVersion !== context.backendVersion ||
    descriptor.page?.id !== context.pageId ||
    descriptor.page.version !== Number(row.page_version) ||
    descriptor.dataset?.id !== row.dataset_id ||
    descriptor.dataset.version !== Number(row.dataset_version) ||
    !Array.isArray(row.catalog)
  )
    return null;
  return { ...descriptor, tables: row.catalog as DatasetBinding["tables"] };
}
