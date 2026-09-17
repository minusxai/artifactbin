import { sqlCode } from './row-scope';

export const SIGNALS_TABLE = '_signals';

/** Routing only: the SQL engine still admits the full statement by its type. */
export function localWriteTarget(sql: string): { name: string; operation: 'update' | 'insert' | 'delete' } | null {
  const match = /^\s*(update|insert\s+into|delete\s+from)\s+([A-Za-z_]\w*)(?=\s|\(|$)/i.exec(sqlCode(sql));
  if (!match) return null;
  const operation = match[1].split(/\s/)[0].toLowerCase() as 'update' | 'insert' | 'delete';
  return {name: match[2], operation};
}
