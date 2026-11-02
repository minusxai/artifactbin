import {paramSqlName} from '@artifactbin/contracts';

/** Normalize native dataset mutation parameter names without changing SQL literals. */
export function rewriteBuiltinFields(sql: string): { sql: string; fields: Map<string, string>; now: boolean; branches: string[] | null; casts: string[] } {
  const fields = new Map<string, string>();
  let out = '', i = 0, now = false, depth = 0, body = -1;
  /** CAST targets, lower-cased: `cast(` opens a cast at the next depth, and the word after its own `as` is the type. */
  const casts: string[] = [], castDepths: number[] = [];
  let castOpens = false, castType = false;
  /** Top-level UNION/INTERSECT/EXCEPT, as [start, end) in the rewritten text. */
  const compounds: Array<[number, number]> = [];
  const skipTo = (end: number) => { out += sql.slice(i, end); i = end; };
  while (i < sql.length) {
    const c = sql[i]!;
    if (c === '\'') {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === '\'') { if (sql[j + 1] === '\'') { j += 2; continue; } break; } j++; }
      if (sql.slice(i + 1, j).toLowerCase() === 'now') now = true;
      skipTo(Math.min(sql.length, j + 1));
    } else if (c === '"' || c === '`') {
      const end = sql.indexOf(c, i + 1);
      skipTo(end < 0 ? sql.length : end + 1);
    } else if (c === '[') {
      const end = sql.indexOf(']', i + 1);
      skipTo(end < 0 ? sql.length : end + 1);
    } else if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      skipTo(end < 0 ? sql.length : end);
    } else if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      skipTo(end < 0 ? sql.length : end + 2);
    } else if (c === '$') {
      const dollar = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(i));
      if (dollar) { const end = sql.indexOf(dollar[0], i + dollar[0].length); skipTo(end < 0 ? sql.length : end + dollar[0].length); continue; }
      const param = /^\$(_[A-Za-z]\w*)\.([A-Za-z_]\w*)/.exec(sql.slice(i));
      if (param) {
        const logical = `${param[1]}.${param[2]}`;
        fields.set(paramSqlName(logical), logical);
        out += `$${paramSqlName(logical)}`;
        i += param[0].length;
      } else { out += c; i++; }
    } else if (/[A-Za-z_]/.test(c) && !/\w/.test(sql[i - 1] ?? '')) {
      const w = /^[A-Za-z_]\w*/.exec(sql.slice(i))![0];
      const lower = w.toLowerCase();
      if (castType) casts.push(lower);
      castType = lower === 'as' && castDepths.at(-1) === depth;
      castOpens = lower === 'cast';
      if (depth === 0 && body < 0 && (lower === 'select' || lower === 'values')) body = out.length;
      if (depth === 0 && (lower === 'union' || lower === 'intersect' || lower === 'except')) {
        const all = /^\s+all\b/i.exec(sql.slice(i + w.length))?.[0] ?? '';
        compounds.push([out.length, out.length + w.length + all.length]);
        out += w + all; i += w.length + all.length;
      } else { out += w; i += w.length; }
    } else {
      if (c === '(') { depth++; if (castOpens) castDepths.push(depth); }
      else if (c === ')') { if (castDepths.at(-1) === depth) castDepths.pop(); depth--; }
      if (!/\s/.test(c)) { castOpens = false; castType = false; }
      out += c; i++;
    }
  }
  // A compound's branches, each a statement of its own (the WITH clause before the first branch is every branch's).
  const branches = compounds.length && body >= 0
    ? [body, ...compounds.map(([, end]) => end)].map((from, n) => out.slice(0, body) + out.slice(from, compounds[n]?.[0] ?? out.length))
    : null;
  return { sql: out, fields, now, branches, casts };
}
