/**
 * CSV cells are all strings. Deciding their types is ingest's job, because
 * `inferColumns` reads the types the caller already chose — correct for JSON,
 * useless for CSV, where handing it raw parser output types every column
 * `string` and silently breaks Vega quantitative encodings.
 *
 * Decisions are made per COLUMN and only when EVERY non-empty value agrees. A
 * column that is half number and half text would break at render time rather
 * than here, so one disagreeing cell demotes the whole column to text.
 */

type ColumnType = 'number' | 'boolean' | 'date' | 'string';

/** A type the uploader declared for a column, via the existing `columns` field. */
export interface DeclaredColumn { name: string; type: string }

/**
 * A number we are willing to convert. Deliberately narrow: `01234` and
 * `+15550100` parse as numbers in JS, and converting them destroys zip codes,
 * phone numbers and IDs — the most common thing in a real spreadsheet that
 * *looks* numeric and must not be.
 */
const SAFE_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
/** ISO only. `03/04/2026` is March 4th or April 3rd depending on the reader. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?$/;

const isBlank = (v: string) => v.trim() === '';

function columnType(values: string[]): ColumnType {
  const present = values.filter((v) => !isBlank(v)).map((v) => v.trim());
  if (present.length === 0) return 'string';
  if (present.every((v) => SAFE_NUMBER.test(v) && Number.isFinite(Number(v)))) return 'number';
  if (present.every((v) => /^(true|false)$/i.test(v))) return 'boolean';
  if (present.every((v) => ISO_DATE.test(v))) return 'date';
  return 'string';
}

function convert(value: string, type: ColumnType): unknown {
  // A blank cell is MISSING, not the empty string — otherwise every chart and
  // aggregate has to special-case `""`.
  if (isBlank(value)) return null;
  const v = value.trim();
  switch (type) {
    // A declared type can be wrong for a given cell. Null is honest and keeps
    // the column's type stable; throwing would reject the whole upload over one
    // stray value.
    case 'number': return Number.isFinite(Number(v)) ? Number(v) : null;
    case 'boolean': return /^(true|false)$/i.test(v) ? v.toLowerCase() === 'true' : null;
    // Dates stay ISO strings: that is what the dataset tier stores and what
    // Vega's temporal encoding parses. Converting to Date would only be
    // re-serialised on the way to the database.
    case 'date': return v;
    default: return value;
  }
}

/**
 * `declared` WINS over the sniffer.
 *
 * The sniffer is a guess and the uploader often knows better — an ID column of
 * `120, 150` is text, not a quantity. Without this, declaring it collided with
 * coercion instead of overriding it: the value became a number and was then
 * rejected by publishDataset's own check ("120 is not a string"), so the
 * documented escape hatch made the request fail outright.
 */
export function coerceRows(
  headers: string[],
  rows: string[][],
  declared: DeclaredColumn[] = [],
): Record<string, unknown>[] {
  const byName = new Map(declared.map((c) => [c.name, c.type]));
  const types = headers.map((header, col) => {
    const chosen = byName.get(header);
    if (chosen === 'number' || chosen === 'boolean' || chosen === 'date' || chosen === 'string') return chosen;
    return columnType(rows.map((r) => r[col] ?? ''));
  });
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    // Header order, so the column order in the file survives into the artifact.
    headers.forEach((header, col) => { out[header] = convert(row[col] ?? '', types[col]); });
    return out;
  });
}
