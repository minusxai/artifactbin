import {boundedRun} from './lib/bounded-run';
const result=await boundedRun('npm',['run','eval','--',...process.argv.slice(2),'--no-retry'],120_000);
console.log(`[eval deadline] total=${result.elapsedMs}ms limit=120000ms ${result.timedOut?'TIMEOUT':result.code===0?'PASS':'FAIL'}; no retry`);
process.exitCode=result.code;
