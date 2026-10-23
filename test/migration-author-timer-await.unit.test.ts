import test from "node:test";
import assert from "node:assert/strict";
import { lowerLegacyTimerAwait } from "../src/migration/conversion/compiled/author/timer-await.ts";
test("legacy standalone timer await resumes through the owned clock with its lexical values", () => {
  const input = '{ const year="2026"; await new Promise(resolve=>setTimeout(resolve,1800)); function draw(){record(year)}; draw(); }';
  const output = lowerLegacyTimerAwait(input, "lifetime");
  const events: string[] = [];let run: (()=>void)|undefined;
  new Function("lifetime","record",output)({timeout:(callback:()=>void,delay:number)=>{assert.equal(delay,1800);run=callback;}},(value:string)=>events.push(value));
  assert.deepEqual(events,[]);run!();assert.deepEqual(events,["2026"]);
  for(const other of ['{await fetch("/data"); record("bad");}', '{const text="await new Promise(resolve=>setTimeout(resolve,1800))";}', 'async function f(){await new Promise(resolve=>setTimeout(resolve,1800));}', '{function draw(){record(value)};await new Promise(resolve=>setTimeout(resolve,1800));const value=1;draw();}'])
    assert.equal(lowerLegacyTimerAwait(other,"lifetime"),other);
});
