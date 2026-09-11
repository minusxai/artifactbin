import {collectionFilters} from './collection-filters';
import {enumArgument} from './arguments';
import {CliError} from './errors';
export {CliError} from './errors';
/** Single executable vocabulary for parsing, help, man pages and local skills. */
export interface Flag { short?: string; value?: string; repeat?: boolean; description: string }
export const flags: Record<string,Flag> = {
 type:{value:'TYPE',description:'Select the resource kind: artifact, folder, dataset, file, profile or session; list adds table; delete adds comment. Fixed names ignore case.'},
 in:{value:'REF',description:'Scope to a containing folder, artifact or dataset.'},
 filter:{value:'FIELD=VALUE',repeat:true,description:'Combine supported filters; run afbin help filters for each collection.'},
 restore:{description:'Restore the selected soft-deleted resources; requires explicit targets.'},
 refresh:{description:'Refresh the selected resources\' external data or imported assets; requires explicit targets.'},
 'secret-env':{value:'NAME',description:'Read a secret value from this environment variable; it is never written to YAML, journals or output.'},
 page:{value:'N',description:'Select a 1-based slide or page.'},
 session:{value:'REF',description:'Attach to an existing authorized remote session instead of launching a command.'},
 output:{short:'o',value:'PATH',description:'Write resulting content to this file or directory.'},
 format:{value:'FORMAT',description:'Select a supported content representation; fixed format names ignore case.'},
 'no-browser':{description:'Print browser URLs without launching a browser; authentication still waits for approval.'},
 version:{description:'Show the installed CLI version.'},
 help:{short:'h',description:'Show local command help.'}, json:{description:'Write one JSON document to stdout; diagnostics go to stderr.'},
 server:{value:'URL',description:'Use this HTTPS server origin.'},yes:{short:'y',description:'Accept confirmation defaults for this operation; browser approval is still required.'},
 'dry-run':{short:'n',description:'Validate the operation without changing local or remote state.'},force:{short:'f',description:'Overwrite local changes on pull, or observe and conditionally replace a stale head on push. On delete, allow referenced assets.'},
 remote:{description:'Fetch current remote state; comparison still runs locally.'},fix:{description:'Apply mechanical local fixes. Push never fixes source.'},
 body:{value:'TEXT',description:'Post this comment text.'},thread:{value:'ID',description:'Select an existing thread for a reply or state change.'},state:{value:'STATE',description:'Set the selected thread to open or resolved; fixed names ignore case.'},
 node:{value:'ID',description:'Anchor a new thread to this node.'},quote:{value:'TEXT',description:'Anchor a new thread to this quote.'},
 limit:{value:'N',description:'Maximum results in this page (1–100).'},cursor:{value:'CURSOR',description:'Continue from a returned next_cursor.'},
 input:{value:'PATH',description:'Read command input from a local file; use - for stdin.'},
 harness:{value:'NAME',repeat:true,description:'Select a skill installation target: claude, codex, pi, opencode; repeat to select several, or use none.'},
 write:{description:'Execute a dataset row mutation explicitly; otherwise queries only read.'},
 param:{value:'NAME=VALUE',repeat:true,description:'Bind a named scalar parameter; repeat for distinct names.'},
 name:{value:'NAME',description:'Select a named query/table, or name a remote terminal session.'},
};
/** Resource kinds are one vocabulary; each command accepts the subset it can address. */
export const RESOURCE_TYPES=['artifact','folder','dataset','file','profile','session'] as const;
const VERSIONED_TYPES=['artifact','folder','dataset','file'] as const;
export const COMMAND_TYPES:Record<string,readonly string[]>={
 pull:RESOURCE_TYPES,push:RESOURCE_TYPES,status:RESOURCE_TYPES,
 diff:['artifact','folder','dataset','file','profile','session'],
 list:[...RESOURCE_TYPES,'table'],
 delete:[...VERSIONED_TYPES,'session','comment'],
 fork:VERSIONED_TYPES,export:VERSIONED_TYPES,log:VERSIONED_TYPES,
};
export const FORMATS:Record<string,readonly string[]>={
 pull:['jsx','yaml','csv','json','original'],export:['png','jpg','html','csv','json','yaml','original'],
 list:['table','csv','json','yaml'],query:['table','csv','json','yaml'],help:['text','markdown','man'],
};
const globalFlags=['help','version','json','server','yes','no-browser'];
export interface Command {name:string; aliases?:string[]; usage:string; description:string; min:number; max:number; flags:string[]; examples:string[]}
export const commands: Command[] = [
 {name:'query',usage:'<ref> [<ref> ...]',description:'Read dataset rows or execute a declared query; local files run locally.',min:1,max:Infinity,flags:['input','name','param','limit','cursor','remote','write','dry-run','output','format'],examples:['afbin query sales.csv','afbin query sales.csv --input report.sql --param minimum=10']},
 {name:'pull',usage:'[<ref> ...]',description:'Retrieve artifacts or account resources and reconcile tracked files.',min:0,max:Infinity,flags:['type','output','format','dry-run','force'],examples:['afbin pull abc123 --output report.jsx','afbin pull report.jsx@2','afbin pull --type profile']},
 {name:'fork',usage:'<ref> [<ref> ...]',description:'Create a distinct private local draft from a resource; publish it later with push.',min:1,max:Infinity,flags:['type','output','dry-run'],examples:['afbin fork abc123 --output copy.jsx','afbin fork report.jsx --dry-run']},
 {name:'export',usage:'<ref> [<ref> ...]',description:'Export rendered images or pages of published heads, or data and original bytes.',min:1,max:Infinity,flags:['type','format','output','name','page','force','dry-run'],examples:['afbin export abc123 --output report.png','afbin export sales.csv --format json --output -']},
 {name:'push',usage:'[<ref> ...]',description:'Create, update or upload; no paths pushes changed tracked files. Markdown converts once to adjacent JSX.',min:0,max:Infinity,flags:['type','restore','refresh','secret-env','dry-run','force'],examples:['afbin push report.jsx','afbin push --dry-run','afbin push --restore abc123']},
 {name:'validate',usage:'[path ...]',description:'Check local files without network access; --remote adds read-only server checks.',min:0,max:Infinity,flags:['fix','remote'],examples:['afbin validate report.jsx','afbin validate --fix report.jsx']},
 {name:'status',usage:'[<ref> ...]',description:'Report local changes, conflicts and installation state; remote state is last observed.',min:0,max:Infinity,flags:['type','remote'],examples:['afbin status','afbin status --remote']},
 {name:'diff',usage:'[<ref> ...]',description:'Compute changes locally against the saved, historical or refreshed base.',min:0,max:Infinity,flags:['type','remote','output'],examples:['afbin diff report.jsx','afbin diff --remote report.jsx']},
 {name:'log',usage:'<ref> [<ref> ...]',description:'List versions, newest first; @version starts at that version or earlier.',min:1,max:Infinity,flags:['type','filter','limit','cursor'],examples:['afbin log report.jsx --limit 10']},
 {name:'list',usage:'[<ref> ...]',description:'List resources or summaries; default accessible artifacts, newest first.',min:0,max:Infinity,flags:['type','in','filter','limit','cursor','format','output'],examples:['afbin list --json','afbin list --type session','afbin list --type table --in orders.yaml']},
 {name:'delete',usage:'<ref> [<ref> ...]',description:'Soft-delete resources, revoke tokens, terminate sessions or delete comments; keep local files.',min:1,max:Infinity,flags:['type','in','dry-run','force'],examples:['afbin delete report.jsx --dry-run','afbin delete --type comment --in abc123 ann_123']},
 {name:'comment',usage:'<ref> [<ref> ...]',description:'List threads, post an anchored comment, reply, resolve or reopen.',min:1,max:Infinity,flags:['body','input','thread','node','quote','state','filter','limit','cursor','dry-run'],examples:['afbin comment report.jsx','afbin comment report.jsx --node heading --body "Clarify this"','afbin comment report.jsx --thread ann_123 --body "Fixed" --state resolved']},
 {name:'open',usage:'<ref> [<ref> ...]',description:'Open the published view of a resource, or print its URL with --no-browser.',min:1,max:Infinity,flags:[],examples:['afbin open report.jsx','afbin open abc123 --no-browser --json']},
 {name:'help',usage:'[topic]',description:'Read bundled markup, data, themes, templates, schemas or command help.',min:0,max:1,flags:['format','output'],examples:['afbin help markup','afbin help dashboard']},
 {name:'setup',usage:'',description:'Authenticate in your browser and install selected local skills.',min:0,max:0,flags:['harness','dry-run'],examples:['afbin setup','afbin setup --harness pi --harness opencode --yes --json']},
 {name:'update',usage:'',description:'Update the compatible CLI and selected local skill bundles.',min:0,max:0,flags:['harness','dry-run'],examples:['afbin update --yes --json']},
 {name:'remote',usage:'[command [args ...]]',description:'Run a local terminal with browser access, or attach to an existing session.',min:0,max:Infinity,flags:['name','session'],examples:['afbin remote pi','afbin remote --name Backend codex','afbin remote --session rs_123']},
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
 if(f.type!==undefined){const choices=COMMAND_TYPES[command.name];if(!choices)throw new CliError('unsupported_flag',`afbin ${command.name} does not accept --type.`,`Run afbin ${command.name} -h.`);f.type=enumArgument(f.type,choices,'type');}
 if(f.filter)collectionFilters(command.name,f.filter as string[]);
 if(f.format!==undefined){const choices=FORMATS[command.name];if(!choices)throw new CliError('unsupported_flag',`afbin ${command.name} does not accept --format.`,`Run afbin ${command.name} -h.`);f.format=enumArgument(f.format,choices,'format');}
 if(f.page!==undefined&&(!/^\d+$/.test(String(f.page))||Number(f.page)<1))throw new CliError('invalid_page','--page must be a positive integer.');
 if(command.name==='push'){
  if(f.restore&&f.refresh)throw new CliError('invalid_arguments','--restore and --refresh are mutually exclusive.');
  if((f.restore||f.refresh)&&!result.positionals.length)throw new CliError('invalid_arguments',`--${f.restore?'restore':'refresh'} requires explicit targets.`,'Name the resources to act on; no target never means all.');
  if(f['secret-env']!==undefined&&!/^[A-Z_][A-Z0-9_]*$/.test(String(f['secret-env'])))throw new CliError('invalid_secret_env','--secret-env names an environment variable, such as PGPASSWORD.');
 }
 if(command.name==='query'&&f['dry-run']&&!f.write)throw new CliError('invalid_arguments','query --dry-run validates a mutation; add --write.','Reads have no side effects; run them directly.');
 if(command.name==='comment'&&f['dry-run']&&f.body===undefined&&f.input===undefined&&!f.state)throw new CliError('invalid_comment','--dry-run checks a proposed comment; add --body, --input or --state.');
 if(command.name==='remote'&&f.session!==undefined&&(result.positionals.length||f.name!==undefined))throw new CliError('invalid_arguments','--session attaches to an existing session; omit the command and --name.');
 if(command.name==='delete'&&f.in!==undefined&&f.type!=='comment')throw new CliError('invalid_arguments','--in identifies the containing artifact for --type comment only.');
 if(command.name==='delete'&&f.type==='comment'&&f.in===undefined)throw new CliError('invalid_arguments','delete --type comment requires --in <artifact>.');
 if(command.name==='export'&&f.output==='-'&&result.positionals.length>1)throw new CliError('ambiguous_output','Stdout holds one export; use an --output directory for several.');
 if(command.name==='export'&&f.output==='-'&&f.json)throw new CliError('conflicting_output','--json cannot share stdout with exported bytes.','Choose a file with --output, or omit --json.');
 if(command.name==='fork'&&f.output==='-')throw new CliError('unsupported_output','fork writes an editable local draft; choose a file or directory with --output.');
 if(f.state!==undefined)f.state=enumArgument(f.state,['open','resolved'],'state');
 if(f.json&&f.format&&f.format!=='json'&&(!f.output||f.output==='-'))throw new CliError('conflicting_output','--json cannot share stdout with another representation.','Choose a file with --output, or omit --json.');
 if(['log','comment'].includes(command.name)&&result.positionals.length>1&&f.cursor)throw new CliError('invalid_cursor','--cursor requires one target.');
 if(f.limit!==undefined&&(!/^\d+$/.test(String(f.limit))||Number(f.limit)<1||Number(f.limit)>100))throw new CliError('invalid_limit','--limit must be an integer from 1 to 100.');
 if(f.harness){const targets=(f.harness as string[]).map(value=>enumArgument(value,['claude','codex','pi','opencode','none'],'harness'));f.harness=targets;if(targets.some(x=>!['claude','codex','pi','opencode','none'].includes(x))||(targets.includes('none')&&targets.length>1)||new Set(targets).size!==targets.length)throw new CliError('invalid_harness','Choose unique harness names; none must be used alone.');}
 if(command.name==='remote'&&f.json)throw new CliError('unsupported_flag','afbin remote streams a terminal and does not accept --json.','Run afbin remote -h.');
 if(command.name==='query'&&f.write&&(f.remote||f.limit||f.cursor||result.positionals.length!==1||(!f.input&&!f.name)||(f.input&&f.name)))throw new CliError('invalid_arguments','--write requires one target and either --input SQL or a declared mutation --name; --remote, --limit and --cursor apply to reads.');
 if(command.name==='query'&&result.positionals.length>1&&(f.input||f.cursor||f.name))throw new CliError('invalid_arguments','--input, --name and --cursor require one query target.');
 if(command.name==='comment'){
  const body=f.body!==undefined||f.input!==undefined;
  if(f.body!==undefined&&f.input!==undefined)throw new CliError('invalid_comment','Use --body or --input, once.');
  if(f.state&&!f.thread)throw new CliError('invalid_comment','--state requires --thread ID.');
  if(f.thread&&(!/^[A-Za-z0-9_-]+$/.test(String(f.thread))||result.positionals.length!==1))throw new CliError('invalid_thread','--thread requires a valid thread ID and exactly one artifact.');
  if(f.thread&&(f.node||f.quote))throw new CliError('invalid_comment','A reply uses the existing thread anchor.');
  if(f.node&&f.quote)throw new CliError('invalid_comment','Use --node or --quote to anchor a new thread.');
  if((body||f.state)&&(f.limit!==undefined||f.cursor!==undefined||f.filter!==undefined))throw new CliError('invalid_comment','--limit and --cursor apply only when listing comments.');
  if(body&&!f.thread&&!f.node&&!f.quote)throw new CliError('invalid_comment','A new thread requires --node ID or --quote TEXT.');
  if(!body&&(f.node||f.quote||f.thread&&!f.state))throw new CliError('invalid_comment','Posting requires --body or --input.');
 }

 return result;
}
export function commandHelp(name?:string):string {
 const command=name?commands.find(c=>c.name===name||c.aliases?.includes(name)):undefined;
 if(name&&!command)throw new CliError('unknown_help_topic',`Unknown command ${name}.`);
 if(!command)return `afbin — local files, published artifacts\n\n${commands.map(c=>`  afbin ${c.name} ${c.usage}\n    ${c.description}`).join('\n')}\n\n<ref> = <url|id|path>[@version]. Published references use ref:<id>.\nRun afbin <command> -h for flags and examples.\nLocal topics: markup, data, themes, templates, errors.\n`;
 return `afbin ${command.name} ${command.usage}\n\n${command.description}\n\n${[...globalFlags.filter(name=>command.name!=='remote'||name!=='json'),...command.flags].map(name=>{const f=flags[name];return `  ${f.short?`-${f.short}, `:''}--${name}${f.value?` <${f.value}>`:''}\n    ${f.description}`;}).join('\n')}\n\nExamples:\n${command.examples.map(x=>`  ${x}`).join('\n')}\n`;
}
