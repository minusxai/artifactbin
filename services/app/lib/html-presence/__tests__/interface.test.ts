import {expect,it} from 'vitest';
import {PRESENCE_EVENT,presenceChannel} from '..';
it('names one LISTEN channel per page: deterministic, case-sensitive and within the identifier limit',()=>{
 const channel=presenceChannel('Page123');
 expect(channel).toMatch(/^af_presence_[a-f0-9]{40}$/);
 expect(channel.length).toBeLessThanOrEqual(63);
 expect(presenceChannel('Page123')).toBe(channel);
 // LISTEN folds unquoted identifiers to lower case; ids differing only in case must not share a room.
 expect(presenceChannel('page123')).not.toBe(channel);
 expect(presenceChannel('')).toMatch(/^af_presence_[a-f0-9]{40}$/);
});
it('frames presence as a named event on the document live stream',()=>{
 expect(PRESENCE_EVENT).toBe('presence');
});
