import {lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import teaching from './generated/teaching.json';
import {STORY_THEME_NAMES,STORY_TEMPLATE_NAMES} from '../../app/lib/validation/atlas-schemas';
import {commands,commandHelp,CliError} from './commands';
import {manPage} from './man';
import {atomicWrite,isMissing} from './files';
export {manPage} from './man';
export const localSkillFiles:Readonly<Record<string,string>>=teaching.files;
export const examples:Record<string,string>={
 editorial:'<article className="mx-auto max-w-3xl p-8"><h1>Report</h1><p>Explain the finding.</p></article>',
 dashboard:'<Helmet><Query name="sales" source="./sales.csv">{`select * from public.rows`}</Query></Helmet>\n<main className="p-8"><h1>Sales</h1><Table data="$sales" /></main>',
 deck:'<SlideDeck><Slide><h1>Presentation</h1><p>One clear point.</p></Slide></SlideDeck>',
 scrolly:'<main><section className="min-h-screen p-8"><h1>Story</h1><p>Begin here.</p></section></main>',
};
const referenceTopics=Object.fromEntries(Object.entries(localSkillFiles).filter(([path])=>path.startsWith('references/')).map(([path,text])=>[path.slice('references/'.length,-3),text]));
export const helpTopics:Record<string,string>={
 ...referenceTopics,
 /** The brief's complete commented document, as a file to copy and adapt. */
 example:teaching.example,
 data:referenceTopics['markup-data'],
 themes:`Available themes: ${STORY_THEME_NAMES.join(', ')}. Set theme in the YAML fence; null clears an explicit choice. Use help themes-<name> for a detailed guide.`,
 templates:`Available templates: ${STORY_TEMPLATE_NAMES.join(', ')}. Run afbin help <template> to print a local example.`,
 ...Object.fromEntries(Object.entries(examples).map(([name,body])=>[name,`---\ntemplate: ${name}\n---\n${body}\n`])),
};
const isCommand=(topic?:string)=>!topic||commands.some(command=>command.name===topic||command.aliases?.includes(topic));
/** The top-level skill doc, without its YAML frontmatter: the brief printed by bare `afbin help`. */
export function briefDocument():string{return localSkillFiles['SKILL.md'].replace(/^---\n[\s\S]*?\n---\n/,'');}
const commandsMarkdown=()=>`# afbin\n\nLocal files and published artifacts. Every command is offline unless it names a remote resource.\n\n`
 +commands.map(command=>`## ${command.name}\n\n\`\`\`text\n${commandHelp(command.name)}\`\`\`\n`).join('\n');
/** One bundled documentation set: help, the manual and the installed skills render the same registry. */
export function helpDocument(topic?:string,format='text'):string{
 // The command list has its own topic name. It shadows the bundled references/commands.md doc,
 // so `afbin help commands` prints the live registry rather than the prose reference.
 if(topic==='commands'){
  if(format==='man')return manPage();
  return format==='markdown'?commandsMarkdown():commandHelp();
 }
 // The agent brief by name, for a terminal whose bare `afbin help` shows the human overview instead.
 if(topic==='brief'){
  if(format==='man')throw new CliError('unsupported_format','The manual documents commands, not the brief.','Read it with --format text or markdown.');
  return briefDocument();
 }
 if(format==='man'){
  if(!isCommand(topic))throw new CliError('unsupported_format',`The manual documents commands, not the ${topic} topic.`,'Read topic guidance with --format text or markdown.');
  return manPage(topic);
 }
 if(!isCommand(topic)){
  const text=helpTopics[topic as string];
  if(text===undefined)throw new CliError('unknown_help_topic',`Unknown help topic ${topic}.`,'Run afbin help.');
  return text;
 }
 // Bare `afbin help` reads the brief; a named command prints its own help. Markdown/man keep the registry.
 if(!topic&&format!=='markdown')return briefDocument();
 if(format!=='markdown')return commandHelp(topic);
 const section=(name:string,heading:string)=>`${heading}\n\n\`\`\`text\n${commandHelp(name)}\`\`\`\n`;
 if(topic)return section(topic,`# afbin ${topic}`);
 return commandsMarkdown();
}
/** --output never replaces an existing path: help has no overwrite permission. */
export async function writeHelp(text:string,destination:string,cwd:string,format:string):Promise<{format:string;output:string;bytes:number}>{
 const path=resolve(cwd,destination);
 const taken=new CliError('output_exists',`Output already exists: ${destination}.`,'Choose a new --output path; afbin help never replaces a file or writes into a directory.');
 if(await lstat(path).then(()=>true,error=>{if(isMissing(error))return false;throw error;}))throw taken;
 try{await atomicWrite(path,text,{exclusive:true});}
 catch(error){
  const code=(error as NodeJS.ErrnoException).code;
  if(code==='EEXIST')throw taken;
  if(code==='ENOENT'||code==='ENOTDIR')throw new CliError('invalid_output',`Cannot write ${destination}: its directory does not exist.`,'Name a path inside an existing directory.');
  throw error;
 }
 return {format,output:path,bytes:Buffer.byteLength(text)};
}
