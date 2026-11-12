/** Current dataset SQL lexer and parameter discovery. */
import { describe, expect, it } from 'vitest';
import {
  bindParameters, datasetSqlParams,
} from '../server';

describe('the $name lexer', () => {
  it('binds each $name outside strings and comments', () => {
    expect(bindParameters('select $a, $b_1 from t where x = $a', (n) => `:${n}`)).toBe('select :a, :b_1 from t where x = :a');
    expect(bindParameters(`select '$a', "$b", $c -- $d\n/* $e */`, (n) => `?${n}`)).toBe(`select '$a', "$b", ?c  \n `);
    expect(bindParameters('', () => 'x')).toBe('');
  });

  it('keeps doubled quotes and nested comments whole', () => {
    expect(bindParameters(`select 'it''s $a', $b /* /* $c */ */`, (n) => n.toUpperCase())).toBe(`select 'it''s $a', B  `);
  });

  it.each([['an unterminated comment', 'select /* $a'], ['an unterminated string', "select '$a"]])('throws on %s', (_label, sql) => {
    expect(() => bindParameters(sql, (n) => n)).toThrow(/Dataset SQL/);
  });

  it('datasetSqlParams lists names once, in first-appearance order', () => {
    expect(datasetSqlParams('select $b, $a, $b from t')).toEqual(['b', 'a']);
    expect(datasetSqlParams("select '$x' -- $y")).toEqual([]);
  });
});
