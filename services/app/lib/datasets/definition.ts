import { formatDatasetDefinition } from '@artifactbin/utils/dataset-definition';
import type { CatalogInput } from './types';
import { DatasetError } from './errors';
import { catalogInputShape } from './input';

const NOT_JSON = 'Dataset definition: the definition is JSON, an object with "kind": "stored" and "tables"; <Dataset> markup is not accepted';

/**
 * A dataset definition as written: a structured object or its JSON text, held to the catalog shape
 * (unknown keys and kinds refused, required fields present). The visual editor and the API share it.
 */
export function parseDatasetDefinition(input: unknown): CatalogInput {
  let authored = input;
  if (typeof input === 'string') {
    try { authored = JSON.parse(input); }
    catch (error) { throw new DatasetError(`${NOT_JSON} (${error instanceof Error ? error.message : 'invalid JSON'})`); }
  }
  const parsed = catalogInputShape.safeParse(authored);
  if (!parsed.success) throw new DatasetError(parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return parsed.data as CatalogInput;
}

/** The stored source: canonical JSON (@artifactbin/utils/dataset-definition). */
export function serializeDatasetDefinition(definition: CatalogInput): string {
  return formatDatasetDefinition(definition);
}
