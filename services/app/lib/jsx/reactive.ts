/** The complete executable vocabulary: data reads and pure scalar operators, never JavaScript evaluation. */
type ReactiveScalar = string | number | boolean | null;
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
export const REACTIVE_BOOLEAN_PROPS: ReadonlySet<string> = new Set(['hidden', 'disabled', 'open', 'checked', 'selected', 'required', 'readOnly', 'multiple', 'autoFocus', 'controls', 'loop', 'muted', 'autoPlay']);

export function isReactiveExpression(value: unknown, depth = 0): value is ReactiveExpression {
  if (depth > 32 || !object(value)) return false;
  switch (value.kind) {
    case 'literal': return scalar(value.value);
    case 'signal': return typeof value.name === 'string' && /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?$/.test(value.name);
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
  // A built-in's field (`$_me.id`) reads like any value; which fields exist is the validator's to say.
  if (node.type === 'MemberExpression' && !node.computed && object(node.object) && object(node.property)
    && node.object.type === 'Identifier' && typeof node.object.name === 'string' && /^\$_[A-Za-z]\w*$/.test(node.object.name)
    && node.property.type === 'Identifier' && typeof node.property.name === 'string' && /^[A-Za-z_]\w*$/.test(node.property.name)) return {kind: 'signal', name: `${node.object.name.slice(1)}.${node.property.name}`};
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
/** The operator a markup expression may not use, with the one it should, for the diagnostic that refuses it. */
const STRICT: Readonly<Record<string, string>> = {'==': '===', '!=': '!=='};

/**
 * Why an Acorn expression is not reactive, when the reason is an operator outside the vocabulary: the first one met,
 * depth-first through conditions and operands. Null when no operator is to blame (a call, an unknown name).
 * Markup compares strictly, so `==` and `!=` are named with their replacements rather than accepted with JavaScript's
 * coercions.
 */
export function reactiveRefusal(node: unknown, depth = 0): string | null {
  if (depth > 32 || !object(node)) return null;
  if ((node.type === 'BinaryExpression' || node.type === 'LogicalExpression') && typeof node.operator === 'string' && !OPS.has(node.operator)) {
    const strict = STRICT[node.operator];
    return strict
      ? `markup compares strictly: write \`${strict}\` instead of \`${node.operator}\``
      : `\`${node.operator}\` is not a markup operator (use ${[...OPS].map((op) => `\`${op}\``).join(', ')} or \`!\`)`;
  }
  for (const key of ['test', 'left', 'right', 'argument', 'consequent', 'alternate']) {
    const found = reactiveRefusal(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}
export { evaluateReactive } from './reactive-eval';

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
