import { describe, expect, it } from 'vitest';
import { mutationUsesRow, rowFieldsInSql, rowRefsIn, analyzeRowScopes } from '../row-scope';
import {parseJsx} from '@/lib/jsx';

it('checks row fields inside reactive predicates and boolean attributes', () => {
  const parsed = parseJsx('<DataTable data="$tasks"><Column col="name">{$_row.active && <span hidden={$_row.missing === null}>{$_row.name}</span>}</Column></DataTable>');
  if (!parsed.ok) throw new Error(parsed.error);
  expect(rowRefsIn(parsed.nodes)).toEqual(['active', 'missing', 'name']);
  const columns = [{name: 'name', type: 'string' as const}, {name: 'active', type: 'boolean' as const}];
  expect(analyzeRowScopes(parsed.nodes, {tasks: columns}).errors).toEqual(['unknown row field "missing" in $tasks']);
});
describe('SQL row scope scanner', () => {
  it('ignores nested comments, quoted strings, identifiers and dollar-quoted text', () => {
    const sql = `/* outer /* inner */ $_row.wrong */ update ref_abc123 set status=$_value where id=$_row.id and '$_row.fake'='$_value' and $$ $_row.dollar $$=$$ text $$ -- $_row.comment
      and status=$_row.status`;
    expect(rowFieldsInSql(sql)).toEqual(['id', 'status']);
    expect(mutationUsesRow(`update ref_abc123 set status='$_value' /* $_row.id */`)).toBe(false);
    expect(mutationUsesRow(`update ref_abc123 set status=$tag$ $_value $tag$`)).toBe(false);
  });
});
