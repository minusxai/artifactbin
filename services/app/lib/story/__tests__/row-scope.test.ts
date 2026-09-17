import { describe, expect, it } from 'vitest';
import { mutationUsesRow, rowFieldsInSql } from '../row-scope';
describe('SQL row scope scanner', () => {
  it('ignores nested comments, quoted strings, identifiers and dollar-quoted text', () => {
    const sql = `/* outer /* inner */ $_row.wrong */ update ref_abc123 set status=$_value where id=$_row.id and '$_row.fake'='$_value' and $$ $_row.dollar $$=$$ text $$ -- $_row.comment
      and status=$_row.status`;
    expect(rowFieldsInSql(sql)).toEqual(['id', 'status']);
    expect(mutationUsesRow(`update ref_abc123 set status='$_value' /* $_row.id */`)).toBe(false);
    expect(mutationUsesRow(`update ref_abc123 set status=$tag$ $_value $tag$`)).toBe(false);
  });
});
