import {expect,it} from 'vitest';
import {normalizeDate,normalizeTimestamp,inferColumns} from '../src/shape';
it.each([
 ['2026-09-18','2026-09-18T00:00:00.000Z'],
 ['2026-09-18 12:30','2026-09-18T12:30:00.000Z'],
 ['2026-09-18T15:30:45.123456+05:30','2026-09-18T10:00:45.123Z'],
 [0,'1970-01-01T00:00:00.000Z'],
])('normalizes %s without depending on the host timezone',(input,expected)=>expect(normalizeTimestamp(input)).toBe(expected));
it.each(['2026-02-30','2026-13-01','09/18/2026','2026-09-18T25:00:00',Infinity,{},'now()'])('names invalid timestamp columns: %s',value=>expect(()=>normalizeTimestamp(value,'happened')).toThrow('happened: invalid timestamp'));
it('infers calendar dates separately from instants',()=>expect(inferColumns([{day:'2026-09-18',instant:'2026-09-18T12:30:00Z'}])).toEqual([{name:'day',type:'date'},{name:'instant',type:'timestamp'}]));
it.each([
 ['2026-11-05','2026-11-05'],
 ['2026-11-05T01:39:09.123Z','2026-11-05'],
 ['2026-11-05 01:39:09','2026-11-05'],
 ['2026-11-05T01:39:09+05:30','2026-11-04'],
 ['2026-11-05T23:30:00-02:00','2026-11-06'],
])('stores the UTC calendar day of a date or ISO timestamp written to a date column: %s',(input,expected)=>expect(normalizeDate(input)).toBe(expected));
it.each(['tomorrow','hi','2026-02-30','2026-02-30T06:00:00Z','2026-13-01',0,{}])('refuses a value that is not a date, naming the column: %s',value=>expect(()=>normalizeDate(value,'created')).toThrow('created: invalid date'));
