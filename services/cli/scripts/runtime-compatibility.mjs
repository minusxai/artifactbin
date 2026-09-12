/** Verify the Linux executable layout and dynamically required ABI before publication. */
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
export function verifyLinuxRuntime(binary,{readelf='readelf'}={}){
 assert.match(execFileSync(readelf,['-h',binary],{encoding:'utf8'}),/Type:\s+EXEC\b/,'SEA runtime must use ET_EXEC');
 // Full symbol tables exceed Node's default 1 MiB capture limit on our Linux builds.
 const symbols=execFileSync(readelf,['--version-info',binary],{encoding:'utf8',maxBuffer:16*1024*1024});
 for(const match of symbols.matchAll(/Name: GLIBC_(\d+)\.(\d+)/g))assert.ok(Number(match[1])<2||Number(match[1])===2&&Number(match[2])<=28,`Runtime requires ${match[0]}`);
 assert.ok(!/Name: GLIBCXX_/.test(symbols),'C++ runtime must be statically linked');
}
