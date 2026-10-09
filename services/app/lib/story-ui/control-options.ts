import { refName, type TableResult } from '@/lib/story/data/dataflow';

export interface ControlOption { value: string; label: string }

/**
 * Authored `options` → a uniform list: a `$table` reference resolves through
 * the supplied table (column 1 the value, column 2 the label when present),
 * an inline array takes strings or `{value, label}` objects.
 */
export function normalizeControlOptions(raw: unknown, table?: TableResult): ControlOption[] {
  if (typeof raw === 'string' && refName(raw)) {
    const [valueCol, labelCol] = table?.columns ?? [];
    if (!table || !valueCol) return [];
    return table.rows.map((row) => {
      const v = String(row[valueCol.name] ?? '');
      return { value: v, label: labelCol ? String(row[labelCol.name] ?? v) : v };
    });
  }
  if (Array.isArray(raw)) {
    return raw.map((o) =>
      typeof o === 'object' && o !== null
        ? { value: String((o as { value?: unknown }).value ?? ''), label: String((o as { label?: unknown }).label ?? (o as { value?: unknown }).value ?? '') }
        : { value: String(o), label: String(o) });
  }
  return [];
}
