import {Readable} from 'node:stream';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {createNotificationSourceReader} from '../notification-source';
afterEach(()=>vi.useRealTimers());
describe('bounded notification source streams',()=>{
 it('reads UTF-8 rows across chunk boundaries and asks for a sentinel byte',async()=>{
  const bytes=Buffer.from(JSON.stringify([{title:'😀 task'}]));
  const getStream=vi.fn(async()=>Readable.from([bytes.subarray(0,12),bytes.subarray(12)]));
  expect(await createNotificationSourceReader({store:{getStream},maxBytes:64}).read('key')).toEqual([{title:'😀 task'}]);
  expect(getStream).toHaveBeenCalledWith('key',{start:0,end:64});
 });
 it('refuses a byte overflow and closes its stream',async()=>{
  const stream=Readable.from([Buffer.alloc(101,32)]),reader=createNotificationSourceReader({store:{getStream:async()=>stream},maxBytes:100});
  await expect(reader.read('key')).rejects.toMatchObject({code:'notification_capacity'});expect(stream.destroyed).toBe(true);
 });
 it('shares row and byte budgets across source tables',async()=>{
  const reader=createNotificationSourceReader({store:{getStream:async()=>Readable.from(['[{"n":1}]'])},maxRows:1});
  expect(await reader.read('one')).toEqual([{n:1}]);await expect(reader.read('two')).rejects.toMatchObject({code:'notification_capacity'});
 });
 it('times out a stalled stream and destroys it',async()=>{
  vi.useFakeTimers();const stream=new Readable({read(){}}),reader=createNotificationSourceReader({store:{getStream:async()=>stream},timeoutMs:10});
  const outcome=expect(reader.read('key')).rejects.toMatchObject({code:'notification_query_timeout'});
  await vi.advanceTimersByTimeAsync(11);await outcome;expect(stream.destroyed).toBe(true);
 });
 it('times out an unavailable response and destroys a stream that arrives late',async()=>{
  vi.useFakeTimers();let resolve!:(value:Readable)=>void;const stream=Readable.from(['[]']);
  const reader=createNotificationSourceReader({store:{getStream:()=>new Promise(r=>{resolve=r;})},timeoutMs:10});
  const outcome=expect(reader.read('key')).rejects.toMatchObject({code:'notification_query_timeout'});
  await vi.advanceTimersByTimeAsync(11);await outcome;resolve(stream);await vi.advanceTimersByTimeAsync(0);expect(stream.destroyed).toBe(true);
 });
 it('fails malformed stored data rather than inventing an empty table',async()=>{
  await expect(createNotificationSourceReader({store:{getStream:async()=>Readable.from(['broken'])}}).read('key')).rejects.toMatchObject({code:'notification_source_invalid'});
 });

 it('shares the byte limit across separately readable sources',async()=>{
  const reader=createNotificationSourceReader({store:{getStream:async()=>Readable.from(['[{"n":1}]'])},maxBytes:12});
  expect(await reader.read('one')).toEqual([{n:1}]);await expect(reader.read('two')).rejects.toMatchObject({code:'notification_capacity'});
 });
});
