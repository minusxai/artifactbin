/** The complete executable vocabulary: data reads and pure scalar operators, never JavaScript evaluation. */
export type ReactiveScalar = string | number | boolean | null;
export type ReactiveExpression =
  | {kind: 'literal'; value: ReactiveScalar}
  | {kind: 'signal'; name: string}
  | {kind: 'row'; field: string}
  | {kind: 'not'; value: ReactiveExpression}
  | {kind: 'binary'; op: '&&' | '||' | '===' | '!==' | '<' | '<=' | '>' | '>='; left: ReactiveExpression; right: ReactiveExpression};

/** Convert only allowlisted Acorn nodes into our small, serializable expression vocabulary. */
const OPS = new Set(['&&', '||', '===', '!==', '<', '<=', '>', '>=']);
const scalar = (value: unknown): value is ReactiveScalar => value === null || typeof value === 'string'
  || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const REACTIVE_BOOLEAN_PROPS: ReadonlySet<string> = new Set(['hidden', 'disabled', 'open']);

export function isReactiveExpression(value: unknown, depth = 0): value is ReactiveExpression {
  if (depth > 32 || !object(value)) return false;
  switch (value.kind) {
    case 'literal': return scalar(value.value);
    case 'signal': return typeof value.name === 'string' && /^[A-Za-z_]\w*$/.test(value.name);
    case 'row': return typeof value.field === 'string' && /^[A-Za-z_]\w*$/.test(value.field);
    case 'not': return isReactiveExpression(value.value, depth + 1);
    case 'binary': return typeof value.op === 'string' && OPS.has(value.op) && isReactiveExpression(value.left, depth + 1) && isReactiveExpression(value.right, depth + 1);
    default: return false;
  }
}

export function reactiveExpression(node: unknown, depth = 0): ReactiveExpression | null {
  if (depth > 32 || !object(node)) return null;
  if (node.type === 'Literal' && scalar(node.value)) return {kind: 'literal', value: node.value};
  if (node.type === 'Identifier' && typeof node.name === 'string' && /^\$[A-Za-z_]\w*$/.test(node.name)) return {kind: 'signal', name: node.name.slice(1)};
  if (node.type === 'MemberExpression' && !node.computed && object(node.object) && object(node.property)
    && node.object.type === 'Identifier' && node.object.name === '$_row' && node.property.type === 'Identifier'
    && typeof node.property.name === 'string') return {kind: 'row', field: node.property.name};
  if (node.type === 'UnaryExpression') {
    const value = reactiveExpression(node.argument, depth + 1);
    if (!value) return null;
    if (node.operator === '!') return {kind: 'not', value};
    if ((node.operator === '-' || node.operator === '+') && value.kind === 'literal' && typeof value.value === 'number') {
      return {kind: 'literal', value: node.operator === '-' ? -value.value : value.value};
    }
  }
  if ((node.type === 'BinaryExpression' || node.type === 'LogicalExpression') && typeof node.operator === 'string' && OPS.has(node.operator)) {
    const left = reactiveExpression(node.left, depth + 1), right = reactiveExpression(node.right, depth + 1);
    if (left && right) return {kind: 'binary', op: node.operator as Extract<ReactiveExpression, {kind: 'binary'}>['op'], left, right};
  }
  return null;
}
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
        // Ordering is defined for matching numeric/string types, not implicit
        // conversion of nulls, booleans, or caller-owned objects.
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

export function reactiveSource(expression: ReactiveExpression): string {
  switch (expression.kind) {
    case 'literal': return JSON.stringify(expression.value);
    case 'signal': return `$${expression.name}`;
    case 'row': return `$_row.${expression.field}`;
    case 'not': return `!(${reactiveSource(expression.value)})`;
    case 'binary': return `(${reactiveSource(expression.left)} ${expression.op} ${reactiveSource(expression.right)})`;
  }
}
export function reactiveNames(expression: ReactiveExpression): {signals: string[]; fields: string[]} {
  const signals = new Set<string>(), fields = new Set<string>();
  const visit = (e: ReactiveExpression, depth = 0) => {
    if (!e || depth > 32) return;
    if (e.kind === 'signal') signals.add(e.name);
    else if (e.kind === 'row') fields.add(e.field);
    else if (e.kind === 'not') visit(e.value, depth + 1);
    else if (e.kind === 'binary') {visit(e.left, depth + 1); visit(e.right, depth + 1);}
  };
  visit(expression);
  return {signals: [...signals], fields: [...fields]};
}
