/**
 * THE `$name` LEXER for authored SQL, shared by the data language and the dataset SQL door: the
 * compiler reads which parameters a connected query binds (`datasetSqlParams`), and lib/datasets/sql
 * binds them before its AST parser sees the statement (`bindParameters`). Lexical only: comments and
 * quoted tokens never become parameters, and dollar strings are normalized because the parser
 * supports them only in function bodies. A leaf of lib/dataflow, so the compiler need not reach the
 * dataset module (and its parser) for one token rule.
 */
const fail = (reason: string): never => { throw new Error(`Dataset SQL: ${reason}`); };

/** `sql` with every `$name` replaced by `bind(name)`. Throws `Dataset SQL: …` on an unterminated token or a positional parameter. */
export function bindParameters(sql: string, bind: (name: string) => string): string {
  let result = '';
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i + 2); i = end < 0 ? sql.length : end; result += ' '; continue;
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) fail('unterminated comment'); result += ' '; continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const start = i; const quote = sql[i++];
      const escaped = quote === "'" && /[eE]/.test(sql[start - 1] ?? '') && (start < 2 || !/[\w$]/.test(sql[start - 2]));
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === '\\') { i += 2; continue; }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue; }
          closed = true; break;
        }
      }
      if (!closed) fail('unterminated quoted token'); result += sql.slice(start, i); continue;
    }
    if (sql[i] === '$') {
      const delimiter = /^(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)/.exec(sql.slice(i))?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, i + delimiter.length);
        if (end < 0) fail('unterminated dollar string');
        result += "'" + sql.slice(i + delimiter.length, end).replaceAll("'", "''") + "'";
        i = end + delimiter.length; continue;
      }
      const name = /^\$([A-Za-z_][A-Za-z_0-9]*)/.exec(sql.slice(i));
      if (!name) return fail('only named parameters are supported');
      result += bind(name[1]); i += name[0].length; continue;
    }
    // The AST parser stores numeric literals as JS numbers. Preserve exact decimal
    // and int8 literals as numeric casts before that conversion can round them.
    const number = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(sql.slice(i));
    if (number) {
      const literal = number[0];
      result += /^[0-9]+$/.test(literal) && Number.isSafeInteger(Number(literal)) ? literal : `('${literal}'::numeric)`;
      i += literal.length; continue;
    }
    // Consume identifiers as a token: dollars inside an identifier are not binds.
    const word = /^[A-Za-z_][A-Za-z_0-9$]*/.exec(sql.slice(i));
    if (word) { result += word[0]; i += word[0].length; continue; }
    result += sql[i++];
  }
  return result;
}

/** The `$name` parameters a dataset query binds, deduplicated in first-appearance order — read by the lexer that binds them. */
export function datasetSqlParams(sql: string): string[] {
  const names: string[] = [];
  bindParameters(sql, (name) => { if (!names.includes(name)) names.push(name); return 'NULL'; });
  return names;
}
