import type { CatalogInput } from './types';

/** Static markup, never evaluated. The visual editor and API share this codec. */
export function parseDatasetDefinition(_source: string): CatalogInput {
  throw new Error('dataset-definition: implement');
}
export function serializeDatasetDefinition(_definition: CatalogInput): string {
  throw new Error('dataset-definition: implement');
}
