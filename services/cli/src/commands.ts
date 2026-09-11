import {enumArgument} from './arguments';
import {CliError} from './errors';
export {CliError} from './errors';
/** Single executable vocabulary for parsing, help, man pages and local skills. */
export interface Flag { short?: string; value?: string; repeat?: boolean; description: string }
export const flags: Record<string,Flag> = {
 output:{short:'o',value:'PATH',description:'Write resulting content to this file or directory.'},
 format:{value:'FORMAT',description:'Select a supported content representation; fixed format names ignore case.'},
 'no-browser':{description:'Print browser URLs without launching a browser; authentication still waits for approval.'},
 version:{description:'Show the installed CLI version.'},
 help:{short:'h',description:'Show local command help.'}, json:{description:'Write one JSON document to stdout; diagnostics go to stderr.'},
 server:{value:'URL',description:'Use this HTTPS server origin.'},yes:{short:'y',description:'Accept confirmation defaults for this operation; browser approval is still required.'},
 'dry-run':{short:'n',description:'Validate the operation without changing local or remote state.'},force:{short:'f',description:'Overwrite local changes on pull, or observe and conditionally replace a stale head on push. On delete, allow referenced assets.'},
 remote:{description:'Fetch current remote state; comparison still runs locally.'},fix:{description:'Apply mechanical local fixes. Push never fixes source.'},
 body:{value:'TEXT',description:'Post this comment text.'},'body-file':{value:'PATH',description:'Read comment text from a file; use - for stdin.'},reply:{value:'THREAD',description:'Reply to this thread on the selected artifact.'},
 node:{value:'ID',description:'Anchor a new thread to this node.'},quote:{value:'TEXT',description:'Anchor a new thread to this quote.'},resolve:{description:'Resolve the thread selected by --reply; may accompany a reply.'},
 limit:{value:'N',description:'Maximum results in this page (1–100).'},cursor:{value:'CURSOR',description:'Continue from a returned next_cursor.'},
 method:{short:'X',value:'METHOD',description:'HTTP method; defaults to GET.'},input:{value:'PATH',description:'Read command input from a local file; use - for stdin.'},
 harness:{value:'NAME',repeat:true,description:'Select a skill installation target: claude, codex, pi, opencode; repeat to select several, or use none.'},
 write:{description:'Execute a dataset row mutation explicitly; otherwise queries only read.'},
 param:{value:'NAME=VALUE',repeat:true,description:'Bind a named scalar parameter; repeat for distinct names.'},
 name:{value:'NAME',description:'Select a named query/table, or name a remote terminal session.'},
};
const globalFlags=['help','version','json','server','yes','no-browser'];
export interface Command {name:string; aliases?:string[]; usage:string; description:string; min:number; max:number; flags:string[]; examples:string[]}
export const commands: Command[] = [
 {name:'query',usage:'<ref> [<ref> ...]',description:'Read dataset rows or execute a declared query; local files run locally.',min:1,max:Infinity,flags:['input','name','param','limit','cursor','remote','write'],examples:['afbin query sales.csv','afbin query sales.csv --input report.sql --param minimum=10']},
 {name:'pull',usage:'[<ref> ...]',description:'Retrieve artifacts and reconcile tracked files.',min:0,max:Infinity,flags:['output','format','dry-run','force'],examples:['afbin pull abc123 --output report.jsx','afbin pull report.jsx@2']},
 {name:'push',usage:'[path ...]',description:'Create, update or upload; no paths pushes changed tracked files. Markdown converts once to adjacent JSX.',min:0,max:Infinity,flags:['dry-run','force'],examples:['afbin push report.jsx','afbin push --dry-run']},
 {name:'validate',usage:'[path ...]',description:'Check local files without network access.',min:0,max:Infinity,flags:['fix'],examples:['afbin validate report.jsx','afbin validate --fix report.jsx']},
 {name:'status',usage:'',description:'Compare local files with saved state; remote state is last observed.',min:0,max:0,flags:['remote'],examples:['afbin status','afbin status --remote']},
 {name:'diff',usage:'[<ref>]',description:'Compute changes locally against the saved base.',min:0,max:1,flags:['remote'],examples:['afbin diff report.jsx','afbin diff --remote report.jsx']},
 {name:'log',usage:'<ref>',description:'List artifact versions, newest first; @version starts at that version or earlier.',min:1,max:1,flags:['limit','cursor'],examples:['afbin log report.jsx --limit 10']},
 {name:'list',aliases:['ls'],usage:'',description:'List your artifacts, newest first.',min:0,max:0,flags:['limit','cursor'],examples:['afbin list --json']},
 {name:'delete',aliases:['rm'],usage:'<ref>',description:'Soft-delete the artifact and forget tracking; keep its local file.',min:1,max:1,flags:['dry-run','force'],examples:['afbin delete report.jsx --dry-run']},
 {name:'comment',usage:'<ref>',description:'List threads, post an anchored comment, reply or resolve.',min:1,max:1,flags:['body','body-file','reply','node','quote','resolve','limit','cursor'],examples:['afbin comment report.jsx','afbin comment report.jsx --node heading --body "Clarify this"','afbin comment report.jsx --reply ann_123 --body "Fixed" --resolve']},
 {name:'help',usage:'[topic]',description:'Read bundled markup, data, themes, templates or command help.',min:0,max:1,flags:[],examples:['afbin help markup','afbin help dashboard']},
 {name:'api',usage:'<path>',description:'Call an advanced HTTP operation; GET by default. See afbin help operations.',min:1,max:1,flags:['method','input'],examples:['afbin api /artifacts','afbin api /artifacts/abc123/fork --method POST --input request.json']},
 {name:'setup',usage:'',description:'Authenticate in your browser and install selected local skills.',min:0,max:0,flags:['harness','dry-run'],examples:['afbin setup','afbin setup --harness pi --harness opencode --yes --json']},
 {name:'update',usage:'',description:'Update the compatible CLI and selected local skill bundles.',min:0,max:0,flags:['harness'],examples:['afbin update --yes --json']},
 {name:'remote',usage:'[command [args ...]]',description:'Run a local terminal with browser access.',min:0,max:Infinity,flags:['name'],examples:['afbin remote pi','afbin remote --name Backend codex']},
];
export interface ParsedCommand {command:string;positionals:string[];flags:Record<string,string|boolean|string[]>}
export function parseCommand(argv:string[]):ParsedCommand {
 const result:ParsedCommand={command:'',positionals:[],flags:{}};
 let literal=false;
 for(let i=0;i<argv.length;i++){
  const token=argv[i];
  if(result.command==='remote'&&result.positionals.length){result.positionals.push(...argv.slice(i));break;}
  if(!literal&&token==='--'){literal=true;continue;}
  if(!literal&&token.startsWith('-')&&token!=='-'){
   const long=token.startsWith('--');
   const equal=long?token.indexOf('='):-1;
   const names=long?[equal<0?token.slice(2):token.slice(2,equal)]:token.slice(1).split('');
   for(let n=0;n<names.length;n++){
    const name=long?names[n]:Object.keys(flags).find(key=>flags[key].short===names[n]);
    const spec=name?flags[name]:undefined;
    if(!name||!spec)throw new CliError('unknown_flag',`Unknown flag ${long?'--':'-'}${names[n]}.`,'Run afbin help <command> for supported flags.');
    let value:string|boolean=true;
    if(spec.value){
     value=long&&equal>=0?token.slice(equal+1):!long&&n+1<names.length?names.slice(n+1).join(''):argv[++i];
     if(value===undefined||value===''||(value.startsWith('-')&&value!=='-'))throw new CliError('missing_flag_value',`--${name} requires ${spec.value}.`);
     n=names.length;
    }else if(equal>=0)throw new CliError('invalid_flag_value',`--${name} is boolean; omit it to disable it.`);
    if(spec.repeat){result.flags[name]=[...(result.flags[name] as string[]|undefined??[]),String(value)];}
    else {if(name in result.flags)throw new CliError('duplicate_flag',`--${name} may be supplied once.`);result.flags[name]=value;}
   }
   continue;
  }
  if(!result.command){
   const command=commands.find(c=>c.name===token||c.aliases?.includes(token));
   if(!command)throw new CliError('unknown_command',`Unknown command ${token}.`,'Run afbin -h.');
   result.command=command.name;
  }else result.positionals.push(token);
 }
 if(!result.command)result.command=result.flags.help?'help':'setup';
 const command=commands.find(c=>c.name===result.command)!;
 for(const name of Object.keys(result.flags))if(!globalFlags.includes(name)&&!command.flags.includes(name))throw new CliError('unsupported_flag',`afbin ${command.name} does not accept --${name}.`,`Run afbin ${command.name} -h.`);
 if(result.flags.help||result.flags.version)return result;
 if(result.positionals.length<command.min||result.positionals.length>command.max)throw new CliError('invalid_arguments',`Usage: afbin ${command.name} ${command.usage}`.trim());
 const f=result.flags;
 if(command.name==='pull'&&f.format!==undefined)f.format=enumArgument(f.format,['jsx','yaml','csv','json','original'],'format');
 if(f.limit!==undefined&&(!/^\d+$/.test(String(f.limit))||Number(f.limit)<1||Number(f.limit)>100))throw new CliError('invalid_limit','--limit must be an integer from 1 to 100.');
 if(f.method&&!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(String(f.method)))throw new CliError('invalid_method','--method must be GET, POST, PUT, PATCH, DELETE or HEAD.');
 if(command.name==='api'&&f.input&&(!f.method||f.method==='GET'||f.method==='HEAD'))throw new CliError('invalid_input','--input requires an explicit write --method.');
 if(f.harness){const targets=(f.harness as string[]).map(value=>enumArgument(value,['claude','codex','pi','opencode','none'],'harness'));f.harness=targets;if(targets.some(x=>!['claude','codex','pi','opencode','none'].includes(x))||(targets.includes('none')&&targets.length>1)||new Set(targets).size!==targets.length)throw new CliError('invalid_harness','Choose unique harness names; none must be used alone.');}
 if(command.name==='remote'&&f.json)throw new CliError('unsupported_flag','afbin remote streams a terminal and does not accept --json.','Run afbin remote -h.');
 if(command.name==='query'&&f.write&&(f.remote||f.limit||f.cursor||result.positionals.length!==1||!f.input))throw new CliError('invalid_arguments','--write requires one target and --input; --remote, --limit and --cursor apply to reads.');
 if(command.name==='query'&&result.positionals.length>1&&(f.input||f.cursor||f.name))throw new CliError('invalid_arguments','--input, --name and --cursor require one query target.');
 if(command.name==='comment'){
  if(f.body!==undefined&&f['body-file']!==undefined)throw new CliError('invalid_comment','Use --body or --body-file, once.');
  if(f.resolve&&!f.reply)throw new CliError('invalid_comment','--resolve requires --reply THREAD.');
  if(f.reply&&(f.node||f.quote))throw new CliError('invalid_comment','A reply uses the existing thread anchor.');
  if(f.node&&f.quote)throw new CliError('invalid_comment','Use --node or --quote to anchor a new thread.');
  const body=f.body!==undefined||f['body-file']!==undefined;
  if((body||f.resolve)&&(f.limit!==undefined||f.cursor!==undefined))throw new CliError('invalid_comment','--limit and --cursor apply only when listing comments.','Run afbin comment <ref> --limit 20 to list a page.');
  if(body&&!f.reply&&!f.node&&!f.quote)throw new CliError('invalid_comment','A new thread requires --node ID or --quote TEXT.');
  if(!body&&(f.node||f.quote||f.reply&&!f.resolve))throw new CliError('invalid_comment','Posting requires --body or --body-file.');
 }
 return result;
}
export function commandHelp(name?:string):string {
 const command=name?commands.find(c=>c.name===name||c.aliases?.includes(name)):undefined;
 if(name&&!command)throw new CliError('unknown_help_topic',`Unknown command ${name}.`);
 if(!command)return `afbin — local files, published artifacts\n\n${commands.map(c=>`  afbin ${c.name} ${c.usage}\n    ${c.description}`).join('\n')}\n\n<ref> = <url|id|path>[@version]. Published references use ref:<id>.\nRun afbin <command> -h for flags and examples.\nLocal topics: markup, data, themes, templates, operations, errors.\n`;
 return `afbin ${command.name} ${command.usage}\n\n${command.description}\n\n${[...globalFlags.filter(name=>command.name!=='remote'||name!=='json'),...command.flags].map(name=>{const f=flags[name];return `  ${f.short?`-${f.short}, `:''}--${name}${f.value?` <${f.value}>`:''}\n    ${f.description}`;}).join('\n')}\n\nExamples:\n${command.examples.map(x=>`  ${x}`).join('\n')}\n`;
}
