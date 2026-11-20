import type { CatalogInput } from './types';
import { DatasetError } from './errors';
import { catalogInputShape } from './input';
import type { DatasetDefinitionShape } from '@artifactbin/utils/dataset-definition';

/** Expand `depth` levels of objects and arrays; anything deeper is written on one line. */
function format(value: unknown, indent: string, depth: number): string {
  if (depth <= 0 || value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  const items = Array.isArray(value)
    ? value.map(item => format(item, inner, depth - 1))
    : Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => `${JSON.stringify(key)}: ${format(item, inner, depth - 1)}`);
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return items.length ? `${open}\n${items.map(item => inner + item).join(',\n')}\n${indent}${close}` : `${open}${close}`;
}

function formatDatasetDefinition(definition: DatasetDefinitionShape): string {
  return format({
    kind: definition.kind,
    defaultSchema: definition.defaultSchema,
    refreshSeconds: definition.refreshSeconds,
    tables: definition.tables.map(({ schema, name, columns, sql, rows }) => ({ schema, name, columns, sql, rows })),
  }, '', 4);
}

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
