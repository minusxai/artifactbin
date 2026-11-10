/**
 * A FUNCTION SCHEDULE read from the source text at publish (./function-source `staticSurface`), checked against the
 * file's callable names and the deployment's shortest interval (./schedule `scheduleManifest`). Never evaluated.
 */
import {describe,expect,it} from 'vitest';
import {staticSurface} from '../function-source';
import {FUNCTION_SCHEDULE_MIN_MINUTES,parseScheduleInterval,scheduleManifest,describeScheduleInterval} from '../schedule';

const MINUTE=60_000,HOUR=60*MINUTE,DAY=24*HOUR;
const FILE=(schedule:string,decl='export const schedule=')=>`${decl}${schedule};export default {async refresh(){return 1},async other(){return 2}};export function named(){return 3}`;
const manifest=async(source:string,minMs=FUNCTION_SCHEDULE_MIN_MINUTES*MINUTE)=>{const s=await staticSurface(source);return scheduleManifest(s.schedule,s.functions,minMs);};

describe('the interval grammar: every N minutes|hours|days',()=>{
 it.each([
  ['every 15 minutes',15*MINUTE],['every 1 hour',HOUR],['every 2 hours',2*HOUR],['every hour',HOUR],['every day',DAY],
  ['every 3 days',3*DAY],['Every 30 Minutes',30*MINUTE],['  every   90   minutes ',90*MINUTE],['every 1 minute',MINUTE],
 ])('%s',(text,ms)=>{expect(parseScheduleInterval(text)).toBe(ms);});
 it.each(['','hourly','every','every 0 hours','every -1 hours','every 1.5 hours','every one hour','every 1 week','every 1 seconds','*/15 * * * *','every 01 hours','every 1 hour and 1 minute','every 400 days'])('refuses %j',(text)=>{
  expect(parseScheduleInterval(text)).toBeNull();
 });
 it('describes an interval back in the same grammar',()=>{
  expect(describeScheduleInterval(HOUR)).toBe('every 1 hour');
  expect(describeScheduleInterval(90*MINUTE)).toBe('every 90 minutes');
  expect(describeScheduleInterval(2*DAY)).toBe('every 2 days');
 });
});

describe('schedule is read statically, like roles',()=>{
 it('no schedule export is no schedule',async()=>{
  expect((await staticSurface('export default {a(){}}')).schedule).toBeNull();
  expect(await manifest('export default {a(){}}')).toBeNull();
 });
 it('an object literal of string literals naming default-export and named functions',async()=>{
  expect(await manifest(FILE("{refresh:'every 1 hour','named':'every 15 minutes'}"))).toEqual({refresh:HOUR,named:15*MINUTE});
  // esbuild folds literal concatenation (text, not evaluation), and TypeScript's `as const` is stripped.
  expect(await manifest(FILE("{refresh:'every '+'2 hours'} as const"))).toEqual({refresh:2*HOUR});
  // A top-level const exported under the name.
  expect(await manifest(`const s={refresh:'every day'};export {s as schedule};export default {refresh(){}}`)).toEqual({refresh:DAY});
 });
 it('schedule is configuration, never a callable name',async()=>{
  expect((await staticSurface(FILE("{refresh:'every 1 hour'}"))).functions).toEqual(['refresh','other','named']);
 });
 it.each([
  ['a computed value',"Object.freeze({refresh:'every 1 hour'})"],
  ['a spread',"{...{refresh:'every 1 hour'}}"],
  ['a computed key',"{['refresh']:'every 1 hour'}"],
  ['__proto__',"{'__proto__':'every 1 hour'}"],
  ['a getter',"{get refresh(){return 'every 1 hour'}}"],
  ['a method',"{refresh(){return 'every 1 hour'}}"],
  ['a shorthand',"{refresh}"],
  ['a template literal',"{refresh:`every 1 hour`}"],
  ['a call',"{refresh:String('every 1 hour')}"],
  ['a number',"{refresh:3600}"],
  ['a repeated key',"{refresh:'every 1 hour',refresh:'every 2 hours'}"],
  ['an array','[]'],
 ])('%s fails publish with invalid_schedule',async(_label,schedule)=>{
  await expect(manifest(FILE(schedule))).rejects.toThrow(/^invalid_schedule: /);
 });
 it.each(['export let schedule=','export var schedule='])('%s fails publish',async(decl)=>{
  await expect(manifest(FILE("{refresh:'every 1 hour'}",decl))).rejects.toThrow(/^invalid_schedule: .*const/);
 });
 it('a destructured or re-exported schedule fails publish',async()=>{
  await expect(staticSurface("export const {schedule}={schedule:{refresh:'every 1 hour'}};export default {refresh(){}}")).rejects.toThrow(/^invalid_schedule: /);
  await expect(staticSurface("export {schedule} from './x';export default {refresh(){}}")).rejects.toThrow(/^invalid_schedule: /);
 });
 it('every key must be a statically declared function',async()=>{
  await expect(manifest(FILE("{missing:'every 1 hour'}"))).rejects.toThrow(/^invalid_schedule: schedule names missing, which .* not .*function/);
  await expect(manifest(FILE("{schedule:'every 1 hour'}"))).rejects.toThrow(/^invalid_schedule: /);
 });
 it('an interval the grammar does not read fails publish, naming the grammar',async()=>{
  for(const text of ['hourly','*/15 * * * *','every 1 week'])
   await expect(manifest(FILE(`{refresh:'${text}'}`)),text).rejects.toThrow(/^invalid_schedule: schedule\.refresh .*every N minutes\|hours\|days/);
 });
 it('below the shortest interval fails publish, naming the minimum',async()=>{
  expect(FUNCTION_SCHEDULE_MIN_MINUTES).toBe(15);
  await expect(manifest(FILE("{refresh:'every 14 minutes'}"))).rejects.toThrow(/^invalid_schedule: schedule\.refresh .*at least every 15 minutes/);
  expect(await manifest(FILE("{refresh:'every 15 minutes'}"))).toEqual({refresh:15*MINUTE});
  // A development or test deployment may allow a shorter one; the check takes the minimum it is given.
  expect(await manifest(FILE("{refresh:'every 1 minute'}"),MINUTE)).toEqual({refresh:MINUTE});
 });
 it('an empty schedule is refused rather than silently meaning nothing',async()=>{
  await expect(manifest(FILE('{}'))).rejects.toThrow(/^invalid_schedule: /);
 });
});
