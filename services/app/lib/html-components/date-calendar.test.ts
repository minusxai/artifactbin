import { describe, expect, it } from 'vitest';
import { inBounds, localToday, monthGrid, moveMonth, validDate } from './date-calendar';
describe('calendar dates', () => {
  it('validates leap years and inclusive bounds', () => {
    expect(validDate('2000-02-29')).toBe(true); expect(validDate('1900-02-29')).toBe(false);
    expect(validDate('2024-02-30')).toBe(false);
    expect(inBounds('2024-02-29',{min:'2024-02-29',max:'2024-02-29'})).toBe(true);
    expect(inBounds('2024-03-01',{max:'2024-02-29'})).toBe(false);
  });
  it('includes adjacent days and crosses years', () => {
    expect(monthGrid({year:2024,month:2})[0]?.value).toBe('2024-01-28');
    expect(monthGrid({year:2024,month:2}).some(d=>d.value==='2024-02-29')).toBe(true);
    expect(moveMonth({year:2024,month:1},-1)).toEqual({year:2023,month:12});
    expect(localToday(()=>new Date(2024,0,1,23,59))).toBe('2024-01-01');
  });
});
it('keeps boundary adjacent days out of selectable ISO range',()=>{
 const first=monthGrid({year:1,month:1}); const last=monthGrid({year:9999,month:12});
 expect(first.filter(d=>!validDate(d.value)).every(d=>!inBounds(d.value,{}))).toBe(true);
 expect(last.some(d=>d.value.startsWith('10000'))).toBe(true);
 expect(last.filter(d=>!validDate(d.value)).every(d=>!inBounds(d.value,{}))).toBe(true);
 expect(moveMonth({year:1,month:1},-1)).toEqual({year:1,month:1});
 expect(moveMonth({year:9999,month:12},1)).toEqual({year:9999,month:12});
});
