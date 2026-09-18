import {expect,it} from 'vitest';
import {normalizeTimestamp,inferColumns} from '../src/shape';
it.each([
 ['2026-09-18','2026-09-18T00:00:00.000Z'],
 ['2026-09-18 12:30','2026-09-18T12:30:00.000Z'],
 ['2026-09-18T15:30:45.123456+05:30','2026-09-18T10:00:45.123Z'],
 [0,'1970-01-01T00:00:00.000Z'],
])('normalizes %s without depending on the host timezone',(input,expected)=>expect(normalizeTimestamp(input)).toBe(expected));
it.each(['2026-02-30','2026-13-01','09/18/2026','2026-09-18T25:00:00',Infinity,{},'now()'])('names invalid timestamp columns: %s',value=>expect(()=>normalizeTimestamp(value,'happened')).toThrow('happened: invalid timestamp'));
it('infers calendar dates separately from instants',()=>expect(inferColumns([{day:'2026-09-18',instant:'2026-09-18T12:30:00Z'}])).toEqual([{name:'day',type:'date'},{name:'instant',type:'timestamp'}]));
