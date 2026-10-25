import {expect,it} from 'vitest';
import {nativeRelationTimestamp} from '../relation-timestamps';
it('compares PostgreSQL Date timestamps to exact retained fractional ISO timestamps',()=>{
 const source='2026-01-02T03:04:05.238Z',stored=new Date(source),before=stored.getTime();
 expect(nativeRelationTimestamp(stored)).toBe(source);
 expect(nativeRelationTimestamp(source)).toBe(source);
 expect(stored.getTime()).toBe(before);
});
it('canonicalizes timezone strings without changing the instant or milliseconds',()=>{
 expect(nativeRelationTimestamp('2026-01-02T08:34:05.976+05:30')).toBe('2026-01-02T03:04:05.976Z');
});
