/** Runtime half of the validated reactive expression grammar. */
import type { ReactiveExpression } from './reactive';

type ReactiveScalar = string | number | boolean | null;
const scalar = (value: unknown): value is ReactiveScalar => value === null || typeof value === 'string'
  || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

/** Evaluate a validated expression against a snapshot; never consult window, prototypes, or functions. */
export function evaluateReactive(expression: ReactiveExpression, signals: Record<string, unknown>, row?: Record<string, unknown>): ReactiveScalar {
  const own = (record: Record<string, unknown> | undefined, name: string): ReactiveScalar => {
    const value = record && Object.hasOwn(record, name) ? record[name] : null;
    return scalar(value) ? value : null;
  };
  const read = (e: ReactiveExpression, depth = 0): ReactiveScalar => {
    if (!e || depth > 32) return null;
    switch (e.kind) {
      case 'literal': return scalar(e.value) ? e.value : null;
      case 'signal': return own(signals, e.name);
      case 'row': return own(row, e.field);
      case 'not': return !read(e.value, depth + 1);
      case 'binary': {
        const left = read(e.left, depth + 1);
        if (e.op === '&&') return left ? read(e.right, depth + 1) : left;
        if (e.op === '||') return left || read(e.right, depth + 1);
        const right = read(e.right, depth + 1);
        if (e.op === '===') return left === right;
        if (e.op === '!==') return left !== right;
        if (!((typeof left === 'number' && typeof right === 'number') || (typeof left === 'string' && typeof right === 'string'))) return false;
        switch (e.op) {
          case '<': return left < right;
          case '<=': return left <= right;
          case '>': return left > right;
          case '>=': return left >= right;
          default: return null;
        }
      }
      default: return null;
    }
  };
  return read(expression);
}
