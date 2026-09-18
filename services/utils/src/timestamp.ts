/** UTC instant contract shared by imports, SQL and reader controls. Precision is milliseconds. */
export function normalizeTimestamp(value: unknown, field = 'timestamp'): string {
  const invalid = (): never => { throw new Error(`${field}: invalid timestamp; use an ISO date/datetime (UTC when omitted), an explicit offset, or epoch milliseconds`); };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalid();
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? invalid() : date.toISOString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? invalid() : value.toISOString();
  if (typeof value !== 'string') return invalid();
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/i.exec(value.trim());
  if (!match) return invalid();
  const day = match[1]!;
  const calendar = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0,10) !== day) return invalid();
  const hour = match[2] ?? '00', minute = match[3] ?? '00', second = match[4] ?? '00';
  if (+hour > 23 || +minute > 59 || +second > 59) return invalid();
  const fraction = (match[5] ?? '').padEnd(3,'0').slice(0,3);
  let offset = (match[6] ?? 'Z').toUpperCase();
  if (/^[+-]\d{2}$/.test(offset)) offset += ':00';
  if (/^[+-]\d{4}$/.test(offset)) offset = `${offset.slice(0,3)}:${offset.slice(3)}`;
  const result = new Date(`${day}T${hour}:${minute}:${second}.${fraction}${offset}`);
  return Number.isNaN(result.getTime()) ? invalid() : result.toISOString();
}

export function isTimestamp(value: unknown): boolean {
  try { normalizeTimestamp(value); return true; } catch { return false; }
}
