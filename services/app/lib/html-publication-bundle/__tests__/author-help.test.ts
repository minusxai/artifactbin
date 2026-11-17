/**
 * The author commands' help, run as an agent runs it: a child process per command (all at once). Kept apart from the
 * in-process check tests beside it (author-check.test.ts, which pr fast's node batch runs) so that file spawns nothing.
 * The installed-skill test (lib/__tests__/native-author-skill.test.ts, a pr fast guard) runs every command's help from
 * the installed ZIP too.
 */
import {expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

it('provides help without reading project files or credentials',async()=>{
 const scripts=['publish','serve','check'];
 const helps=await Promise.all(scripts.map(script=>promisify(execFile)(process.execPath,[new URL('../../../skills/artifactbin/scripts/'+script+'.mjs',import.meta.url).pathname,'--help'],{encoding:'utf8'})));
 scripts.forEach((script,index)=>expect(helps[index]!.stdout,script).toContain('Usage:'));
});
