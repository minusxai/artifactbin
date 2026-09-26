import { describe, expect, it } from 'vitest';
import { analyzeRowScopes } from '../row-scope';
import { rewriteBuiltinFields } from '../compile-dataflow';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
describe('row scope', () => {
  // Which row fields a statement reads is the compiler's answer (rewriteBuiltinFields), not a scan here.
  it('the compiler reads row fields from code only: not comments, strings or quoted identifiers', () => {
    const sql = `/* $_row.wrong */ update items.rows set status=$_value where id=$_row.id and '$_row.fake'='$_value' and "$_row.quoted" = 1 -- $_row.comment
      and status=$_row.status`;
    expect([...rewriteBuiltinFields(sql).fields.values()]).toEqual(['_row.id', '_row.status']);
    expect([...rewriteBuiltinFields(`update items.rows set status='$_value' /* $_row.id */`).fields.values()]).toEqual([]);
  });
  it('accepts DatePicker as a DataTable cell editor and still rejects Slider', () => {
    const table = (editor: string) => analyzeRowScopes(parseJsxOrThrow(`<DataTable data="$tasks" rowKey="id"><Column col="due">${editor}</Column></DataTable>`).nodes);
    const date = table('<DatePicker label="Due" value="$_row.due" run="$set_due" />');
    expect(date.errors).toEqual([]);
    expect(date.cellColumns).toEqual({ set_due: 'due' });
    expect(table('<Slider value="$_row.due" run="$set_due" />').errors).toEqual([expect.stringContaining('DatePicker')]);
  });
});
