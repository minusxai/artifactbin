/** Convert a reader control's string to the declared scalar type. In lib/dataflow: URL values (./url-values) coerce with it too. */
import { normalizeTimestamp, isTimestamp } from '@artifactbin/utils/shape';
import type { ColumnType } from '@artifactbin/contracts';
import type { Scalar } from './dataflow';

export function coerceScalarInput(type: ColumnType | 'table' | undefined, raw: string): Scalar {
  if (raw === '') return null;
  if (type === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : null; }
  if (type === 'boolean') return raw === 'true';
  if (type === 'timestamp') return isTimestamp(raw) ? normalizeTimestamp(raw) : null;
  return raw;
}
