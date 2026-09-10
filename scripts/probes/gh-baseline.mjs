// A gh-inspired noun/action comparison skin, not an implementation of GitHub's gh.
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2), base=fileURLToPath(new URL('./cli.mjs',import.meta.url));
const mapping={view:'pull',create:'push',edit:'push',history:'log'};
let argv=args;
if(args[0]==='artifact') {
 const action=args[1];if(!mapping[action]){console.log(JSON.stringify({code:'unknown_command',fix:'afbin --help'}));process.exit(1);}
 const lock=existsSync('.artifactbin/lock.json')?JSON.parse(readFileSync('.artifactbin/lock.json','utf8')):{};
 const paths=args.slice(2).filter(x=>!x.startsWith('-'));
 if(action==='create'&&(!paths.length||paths.some(p=>lock[p]))){console.log(JSON.stringify({code:'already_tracked',fix:'Use afbin artifact edit for tracked files.'}));process.exit(1);}
 if(action==='edit'&&paths.some(p=>!lock[p])){console.log(JSON.stringify({code:'untracked_file',fix:'Use afbin artifact create for a new file.'}));process.exit(1);}
 argv=[mapping[action],...args.slice(2)];
} else if(['push','pull','log'].includes(args[0])){console.log(JSON.stringify({code:'unknown_command',fix:'Use afbin artifact create/edit/view/history; afbin --help lists grammar.'}));process.exit(1);}
const r=spawnSync(process.execPath,[base,...argv],{encoding:'utf8'});
const rewrite=s=>s.replace(/afbin push <path> first/g,'afbin artifact create <path> first').replace(/\bpush\b/g,'artifact edit').replace(/\bpull\b/g,'artifact view').replace(/\blog\b/g,'artifact history').replace(/Create explicit new files; update changed tracked files./g,'Update changed tracked files. Use artifact create <path> for new files.');
let out=rewrite(r.stdout||'');if(args.includes('--help')||args.includes('-h'))out+='\nartifact create <path ...>  Publish new files; artifact edit updates tracked files.\n';
process.stdout.write(out);process.stderr.write(rewrite(r.stderr||''));process.exitCode=r.status??1;
