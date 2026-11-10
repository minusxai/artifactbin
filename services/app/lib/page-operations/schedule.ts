/**
 * FUNCTION SCHEDULES — `export const schedule = {refresh: 'every 1 hour'}` in a typeDefs-free backend: which of its
 * functions run on their own, and how often. Read from the source text at publish (./function-source
 * `staticSurface`, the same static read as `roles`) and checked here; lib/function-schedules runs them.
 *
 * THE GRAMMAR is an interval, `every [N] minute(s)|hour(s)|day(s)`, not cron: a scheduled function pulls data on a
 * period, and an interval makes the three rules a schedule needs checkable from the text alone — the shortest
 * interval (cron's real gap is not its field, `0,1 * * * *` runs a minute apart), no overlap (the next run is an
 * interval after the last one finished) and backoff (a multiple of the interval). Pure: no I/O.
 */
/** The shortest interval a deployment allows. A development or test process may lower it (lib/platform config). */
export const FUNCTION_SCHEDULE_MIN_MINUTES=15;
/** The longest interval: a year (and so no overflow anywhere a time is computed from it). */
const MAX_MS=366*24*60*60_000;
const UNIT_MS={minute:60_000,hour:60*60_000,day:24*60*60_000} as const;
const GRAMMAR=/^every\s+(?:([1-9][0-9]{0,5})\s+)?(minute|hour|day)s?$/i;
export const SCHEDULE_FORM="declare export const schedule = {name: 'every N minutes|hours|days', …} as an object literal";
const refuse=(why:string):never=>{throw Error(`invalid_schedule: ${why}; ${SCHEDULE_FORM}`);};

/** The interval in milliseconds, or null when the text is not `every [N] minute(s)|hour(s)|day(s)`. */
export function parseScheduleInterval(text:string):number|null{
 const match=GRAMMAR.exec(text.trim().replace(/\s+/g,' '));
 if(!match)return null;
 const ms=Number(match[1]??'1')*UNIT_MS[match[2]!.toLowerCase() as keyof typeof UNIT_MS];
 return ms<=MAX_MS?ms:null;
}
/** An interval in the grammar's own words, in its largest whole unit. */
export function describeScheduleInterval(ms:number):string{
 for(const unit of ['day','hour','minute'] as const){
  const n=ms/UNIT_MS[unit];
  if(Number.isInteger(n)&&n>=1)return `every ${n} ${unit}${n===1?'':'s'}`;
 }
 return `every ${ms} milliseconds`;
}
/**
 * The schedule a file publishes, `{name: intervalMs}`, or null when it declares none. Every key must be one of the
 * file's statically declared functions (`functions`, ./function-source), every value an interval of the grammar no
 * shorter than `minMs`. An empty schedule is refused: it is a mistake, never a meaning.
 */
export function scheduleManifest(declared:ReadonlyArray<readonly [string,string]>|null,functions:readonly string[],minMs:number):Record<string,number>|null{
 if(declared===null)return null;
 if(!declared.length)refuse('schedule names no function');
 const manifest:Record<string,number>={};
 for(const [name,text] of declared){
  if(!functions.includes(name))refuse(`schedule names ${name}, which this file does not export as a function`);
  const ms=parseScheduleInterval(text);
  if(ms===null)refuse(`schedule.${name} is ${JSON.stringify(text)}; write every N minutes|hours|days`);
  if(ms!<minMs)refuse(`schedule.${name} is ${JSON.stringify(text)}, shorter than this deployment allows: run it at least ${describeScheduleInterval(minMs)} apart`);
  manifest[name]=ms!;
 }
 return manifest;
}
