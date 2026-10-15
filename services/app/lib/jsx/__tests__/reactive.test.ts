import { describe, expect, it } from 'vitest';
import { Parser } from 'acorn';
import { reactiveExpression, evaluateReactive, reactiveNames, reactiveSource } from '../reactive';

const parse = (source: string) => reactiveExpression(Parser.parseExpressionAt(source, 0, {ecmaVersion: 'latest'}));
describe('restricted reactive expressions', () => {
  it('reads signals and compares scalars with short-circuit logic', () => {
    const expr = parse('$view === "dag" && !$busy')!;
    expect(expr).not.toBeNull();
    expect(evaluateReactive(expr, {view: 'dag', busy: false})).toBe(true);
    expect(evaluateReactive(expr, {view: 'table', busy: false})).toBe(false);
    expect(parse(reactiveSource(expr))).toEqual(expr);
    expect(reactiveNames(expr)).toEqual({signals: ['view', 'busy'], fields: []});
  });
  it('supports own-field row reads and never reads prototype properties', () => {
    const expr = parse('$_row.hours >= $minimum')!;
    expect(expr).not.toBeNull();
    expect(evaluateReactive(expr, {minimum: 2}, {hours: 4})).toBe(true);
    expect(reactiveNames(expr)).toEqual({signals: ['minimum'], fields: ['hours']});
    expect(evaluateReactive(parse('$constructor')!, {})).toBeNull();
    expect(evaluateReactive(parse('$_row.constructor')!, {}, {})).toBeNull();
  });
  it('reads a query\'s first-row cell as a dotted signal, as a built-in\'s field is read', () => {
    expect(parse('$tiles.cheap_v')).toEqual({kind: 'signal', name: 'tiles.cheap_v'});
    expect(parse('$_me.id')).toEqual({kind: 'signal', name: '_me.id'});
    const expr = parse('$tiles.n > 3')!;
    expect(evaluateReactive(expr, {'tiles.n': 4})).toBe(true);
    expect(reactiveNames(expr).signals).toEqual(['tiles.n']);
    expect(parse(reactiveSource(expr))).toEqual(expr);
  });
  it.each(['null', 'false', 'true', '0', '-2', '"hello"'])('round-trips scalar literal %s', source => {
    const expr = parse(source);
    expect(expr).not.toBeNull();
    expect(parse(reactiveSource(expr!))).toEqual(expr);
  });
  it.each(['window', 'document.cookie', '$x()', 'fetch("x")', '$_row["name"]', '$x.value.deep', '$x["value"]', '$x = 1', '++$x', 'new Function("return 1")', '$x + 1', '() => true'])('rejects capability or unsupported expression %s', source => {
    expect(parse(source)).toBeNull();
  });
});
