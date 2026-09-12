import {commands,flags,globalFlags,CliError,type Command} from './commands';
import {CLI_VERSION} from './version';
import {helpTopics,examples} from './teaching';
import {createStyle,wrap,visibleWidth,type Style,type StyleOptions} from './style';
/** Human help for a terminal, rendered from the same registry as the plain text, manual and skills. */
export interface ScreenOptions extends StyleOptions {columns?:number}
export const COMMAND_GROUPS:ReadonlyArray<readonly [string,readonly string[]]>=[
 ['Local files',['pull','push','fork','status','diff','validate']],
 ['Published resources',['list','log','export','query','delete','comment','open']],
 ['Setup and help',['setup','auth','update','remote','help']],
];
const TAGLINE='Google Docs for agents.';
/** Derive every displayed topic from the bundled help so new guides remain discoverable. */
function topicEntries(s:Style):Entry[]{
 const groups=new Map<string,string[]>();
 for(const topic of ['brief',...Object.keys(helpTopics).sort()]){
  const group=['brief','commands','example'].includes(topic)?'Start here':topic==='templates'||topic.startsWith('templates-')||topic in examples?'Templates':topic==='themes'||topic.startsWith('themes-')?'Themes':topic.startsWith('publishing')?'Publishing':topic==='markup'||topic.startsWith('markup-')?'Markup':'Authoring';
  groups.set(group,[...(groups.get(group)??[]),topic]);
 }
 return ['Start here','Authoring','Markup','Templates','Themes','Publishing'].map(group=>({label:`  ${s.dim(group)}`,text:groups.get(group)!.map(topic=>s.cyan(topic)).join(', ')}));
}
/** The first clause of a command's description: enough for one overview row. */
export function summary(command:Command):string{return command.description.split(/[;.]/)[0].trim();}
const width=(options:ScreenOptions)=>Math.min(120,Math.max(60,options.columns??100));
const byName=(name:string)=>commands.find(c=>c.name===name||c.aliases?.includes(name));
interface Entry {label:string;text:string}
const flagEntry=(s:Style)=>(name:string):Entry=>{
 const f=flags[name];
 return {label:`  ${f.short?`-${f.short}, `:'    '}${s.cyan(s.bold(`--${name}`))}${f.value?` ${s.cyan(`<${f.value}>`)}`:''}`,text:f.description};
};
/** Aligned rows: the label, then the text wrapped with a hanging indent at the column. */
function rows(entries:readonly Entry[],total:number,column:number):string[]{
 return entries.flatMap(({label,text})=>wrap(text,total-column).map((line,i)=>i===0?`${label}${' '.repeat(column-visibleWidth(label))}${line}`:`${' '.repeat(column)}${line}`));
}
const columnFor=(entries:readonly Entry[])=>Math.max(...entries.map(e=>visibleWidth(e.label)))+2;
export function overviewScreen(options:ScreenOptions):string{
 const s=createStyle(options);const w=width(options);
 const heading=(text:string)=>s.accent(s.bold(`${text}:`));
 const commandEntries=COMMAND_GROUPS.map(([group,names])=>[group,names.map(name=>{const c=byName(name)!;return {label:`  ${s.cyan(s.bold(c.name))}`,text:summary(c)};})] as const);
 const column=columnFor(commandEntries.flatMap(([,entries])=>entries));
 const global=globalFlags.map(flagEntry(s));
 const out=[`${s.bold(s.wordmark('afbin'))} ${s.bold(CLI_VERSION)}`,s.dim(TAGLINE),'',`${heading('Usage')} afbin ${s.cyan('<command>')} [options] [<ref> ...]`,''];
 for(const [group,entries] of commandEntries)out.push(heading(group),...rows(entries,w,column),'');
 out.push(heading('Global options'),...rows(global,w,columnFor(global)),'');
 out.push(...wrap(`${s.cyan('<ref>')} = <url|id|path>[@version]; published references use ref:<id>.`,w));
 out.push('',heading('Help topics'),...wrap(`Run ${s.cyan('afbin help <topic>')} with any topic below:`,w),'');
 const topics=topicEntries(s);out.push(...rows(topics,w,columnFor(topics)),'');
 out.push(...wrap(`Run ${s.cyan('afbin help <command>')} for flags and examples, or ${s.cyan('afbin help brief')} for the agent brief.`,w));
 return out.join('\n')+'\n';
}
export function commandScreen(name:string,options:ScreenOptions):string{
 const command=byName(name);
 if(!command)throw new CliError('unknown_help_topic',`Unknown command ${name}.`);
 const s=createStyle(options);const w=width(options);
 const heading=(text:string)=>s.accent(s.bold(`${text}:`));
 const own=command.flags.map(flagEntry(s));
 const global=globalFlags.filter(flag=>command.name!=='remote'||flag!=='json').map(flagEntry(s));
 const column=columnFor([...own,...global]);
 const out=[`${s.bold(s.wordmark('afbin'))} ${s.bold(command.name)}`,...wrap(command.description,w),'',`${heading('Usage')} afbin ${s.cyan(command.name)} ${command.usage}`.trimEnd(),''];
 if(own.length)out.push(heading('Options'),...rows(own,w,column),'');
 out.push(heading('Global options'),...rows(global,w,column),'');
 out.push(heading('Examples'),...command.examples.map(example=>`  ${example}`));
 return out.join('\n')+'\n';
}
/** The screen for a terminal: the overview, or one command. Other topics keep their bundled text. */
export function helpScreen(topic:string|undefined,options:ScreenOptions):string|undefined{
 if(!topic)return overviewScreen(options);
 return byName(topic)?commandScreen(topic,options):undefined;
}
