import { describe, expect, it } from 'vitest';
import { analyzeRowScopes, mutationUsesRow, rowFieldsInSql } from '../row-scope';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
describe('SQL row scope scanner', () => {
  it('ignores nested comments, quoted strings, identifiers and dollar-quoted text', () => {
    const sql = `/* outer /* inner */ $_row.wrong */ update ref_abc123 set status=$_value where id=$_row.id and '$_row.fake'='$_value' and $$ $_row.dollar $$=$$ text $$ -- $_row.comment
      and status=$_row.status`;
    expect(rowFieldsInSql(sql)).toEqual(['id', 'status']);
    expect(mutationUsesRow(`update ref_abc123 set status='$_value' /* $_row.id */`)).toBe(false);
    expect(mutationUsesRow(`update ref_abc123 set status=$tag$ $_value $tag$`)).toBe(false);
  });
  it('accepts DatePicker as a DataTable cell editor and still rejects Slider', () => {
    const table = (editor: string) => analyzeRowScopes(parseJsxOrThrow(`<DataTable data="$tasks" rowKey="id"><Column col="due">${editor}</Column></DataTable>`).nodes);
    const date = table('<DatePicker label="Due" value="$_row.due" run="$set_due" />');
    expect(date.errors).toEqual([]);
    expect(date.cellColumns).toEqual({ set_due: 'due' });
    expect(table('<Slider value="$_row.due" run="$set_due" />').errors).toEqual([expect.stringContaining('DatePicker')]);
  });
});
