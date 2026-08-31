import type { ParsedCsv } from './types';

/**
 * RFC 4180 parse, character by character.
 *
 * Hand-rolled rather than a dependency: the grammar is small and fully
 * specified, and the only genuinely awkward rule — a quoted field may contain
 * the delimiter AND a newline — is exactly the rule a naive `split('\n')`
 * gets wrong. That single case is why this is a state machine and not four
 * lines of splitting.
 */
export function parseCsv(text: string): ParsedCsv {
  // Excel writes a BOM; left in place it becomes part of the first header and
  // every later lookup of that column silently misses.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let sawAnyChar = false;

  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => { endField(); records.push(record); record = []; };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else if (ch === '\r' && input[i + 1] === '\n') {
        // CRLF inside a quoted field is still a line ending, not data: a literal
        // CR would ride into chart labels and table cells as invisible garbage.
        field += '\n';
        i++;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; sawAnyChar = true; continue; }
    if (ch === ',') { endField(); sawAnyChar = true; continue; }
    if (ch === '\r') continue;               // CRLF → LF
    if (ch === '\n') { endRecord(); sawAnyChar = true; continue; }
    field += ch;
    sawAnyChar = true;
  }
  // A trailing newline must not invent an empty record; anything else must not
  // lose the last field.
  if (field !== '' || record.length > 0) endRecord();

  if (!sawAnyChar || records.length === 0) return { headers: [], rows: [] };

  const headers = uniqueHeaders(records[0]);
  const width = headers.length;
  const rows = records.slice(1).map((r) =>
    // Pad short rows so every row is addressable by header index. Over-long
    // rows keep their extra cells rather than being truncated — losing data
    // silently is worse than carrying a cell nobody names.
    r.length < width ? [...r, ...Array(width - r.length).fill('')] : r,
  );
  return { headers, rows };
}

/**
 * Headers must be unique and non-empty or the objects built from them lose
 * columns — `{a: 1, a: 2}` keeps only the last, and `''` is unusable as a key.
 */
function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((name, i) => {
    const base = name.trim() || `column_${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}
