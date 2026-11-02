/** The small row identity rule shared by comments, repeat validation and the island runtime. */
export type CommentKey = string | number;

export const isCommentKey = (value: unknown): value is CommentKey =>
  (typeof value === 'string' && value.length <= 256 && !/[\u0000-\u001f]/.test(value))
  || (typeof value === 'number' && Number.isFinite(value));

export function keyedRowsError(rows: Record<string, unknown>[], field: string, label = 'rowKey'): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = Object.hasOwn(row, field) ? row[field] : undefined;
    if (!isCommentKey(value)) return `${label} must have a non-null string (at most 256 characters, without control characters) or finite number for every row`;
    const key = JSON.stringify([typeof value, value]);
    if (seen.has(key)) return `${label} must be unique; duplicate key ${String(value)}`;
    seen.add(key);
  }
  return null;
}
