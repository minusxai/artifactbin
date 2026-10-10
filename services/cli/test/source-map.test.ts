/**
 * THE SOURCE MAP (src/README.md) agrees with the source: every command `dispatch.ts` routes has a row,
 * every row is a routed command, every backticked source path names a file under src/, and every source
 * file under src/ is listed (generated/ excepted: it is built, never committed).
 *
 * A routed command is a string literal `dispatch.ts` compares `command` with (`command==='x'`,
 * `command!=='x'`) or lists in an array it calls `.includes(command)` on.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join,relative,sep} from 'node:path';

const SRC=join(import.meta.dirname,'..','src');

export function routedCommands(dispatch:string):string[]{
 const found=new Set<string>();
 for(const match of dispatch.matchAll(/\bcommand\s*[!=]==?\s*'([a-z][a-z-]*)'/g))found.add(match[1]!);
 for(const match of dispatch.matchAll(/\[([^\]]*)\]\.includes\(command\)/g))for(const item of match[1]!.matchAll(/'([a-z][a-z-]*)'/g))found.add(item[1]!);
 return [...found].sort();
}

/** Command rows: a table line whose first cell is one backticked word with no file extension. */
export function commandRows(markdown:string):string[]{
 return markdown.split('\n').map(line=>/^\|\s*`([a-z][a-z-]*)`\s*\|/.exec(line)?.[1]).filter((row):row is string=>!!row);
}

/** Every backticked source path anywhere in the map. */
export function mappedPaths(markdown:string):string[]{
 return [...new Set([...markdown.matchAll(/`([\w./-]+\.tsx?)`/g)].map(match=>match[1]!))].sort();
}

export function mapProblems(commands:string[],rows:string[],paths:string[],files:string[]):string[]{
 const problems:string[]=[];const want=new Set(commands),seen=new Set<string>(),known=new Set(files),mapped=new Set(paths);
 for(const row of rows){if(seen.has(row))problems.push(`${row} has two rows`);seen.add(row);if(!want.has(row))problems.push(`${row} has a row but dispatch.ts routes no such command`);}
 for(const command of commands)if(!seen.has(command))problems.push(`${command} is routed by dispatch.ts and has no row`);
 for(const path of paths)if(!known.has(path))problems.push(`${path} is in the map but not under src/`);
 for(const file of files)if(!mapped.has(file))problems.push(`${file} is under src/ and not in the map`);
 return problems;
}

function sourceFiles(dir=SRC):string[]{
 return readdirSync(dir).flatMap(name=>{
  const path=join(dir,name);
  if(statSync(path).isDirectory())return name==='generated'?[]:sourceFiles(path);
  return /\.tsx?$/.test(name)?[relative(SRC,path).split(sep).join('/')]:[];
 }).sort();
}

test('routed commands are read from comparisons and includes() lists',()=>{
 const dispatch="if(command==='push'&&x)a();if(['pull','delete'].includes(command))b();if(command!=='log')c();const y=flags.type==='session';";
 assert.deepEqual(routedCommands(dispatch),['delete','log','pull','push']);
});

test('the check names a command without a row, a row without a command, a missing file and an unlisted file',()=>{
 const markdown='| Command | Handler |\n|---|---|\n| `push` | `sync.ts` |\n| `gone` | `gone.ts` |\n';
 assert.deepEqual(commandRows(markdown),['push','gone']);
 assert.deepEqual(mappedPaths(markdown),['gone.ts','sync.ts']);
 assert.deepEqual(mapProblems(['pull','push'],commandRows(markdown),mappedPaths(markdown),['pull.ts','sync.ts']),[
  'gone has a row but dispatch.ts routes no such command',
  'pull is routed by dispatch.ts and has no row',
  'gone.ts is in the map but not under src/',
  'pull.ts is under src/ and not in the map',
 ]);
});

test('src/README.md maps every routed command and every source file',()=>{
 const commands=routedCommands(readFileSync(join(SRC,'dispatch.ts'),'utf8'));
 assert.ok(commands.length>=34,`only ${commands.length} commands found in dispatch.ts`);
 const markdown=readFileSync(join(SRC,'README.md'),'utf8');
 const files=sourceFiles();
 assert.ok(files.length>=100&&existsSync(join(SRC,'dispatch.ts')));
 assert.deepEqual(mapProblems(commands,commandRows(markdown),mappedPaths(markdown),files),[]);
});
