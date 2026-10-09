import { describe, expect, it } from 'vitest';
import { analyzeRowScopes, parseRowRef, substituteRow } from '../row-scope';
import { rewriteBuiltinFields } from '@/lib/story/data/compile-dataflow';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
describe('row scope', () => {
  it('reads an exact $_row reference, and fills one or a template from the row', () => {
    expect(parseRowRef('$_row.city')).toBe('city');
    expect(parseRowRef(' $_row.city')).toBeNull();
    expect(parseRowRef('$_row.')).toBeNull();
    expect(parseRowRef(3)).toBeNull();
    expect(substituteRow('$_row.orders', { orders: 4 })).toBe(4);
    expect(substituteRow('$_row.missing', {})).toBeNull();
    expect(substituteRow('{$_row.city}: { $_row.orders }', { city: 'Pune', orders: 4 })).toBe('Pune: 4');
    expect(substituteRow(7, { city: 'Pune' })).toBe(7);
  });
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
