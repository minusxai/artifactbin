import {resolve} from 'node:path';
import teaching from './generated/teaching.json';
import {STORY_THEME_NAMES,STORY_TEMPLATE_NAMES} from '../../app/lib/validation/atlas-schemas';
import {commands,commandHelp,CliError} from './commands';
import {manPage} from './man';
import {atomicWrite,readOptional} from './files';
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
 data:referenceTopics['markup-data'],
 themes:`Available themes: ${STORY_THEME_NAMES.join(', ')}. Set theme in the YAML fence; null clears an explicit choice. Use help themes-<name> for a detailed guide.`,
 templates:`Available templates: ${STORY_TEMPLATE_NAMES.join(', ')}. Run afbin help <template> to print a local example.`,
 ...Object.fromEntries(Object.entries(examples).map(([name,body])=>[name,`---\ntemplate: ${name}\n---\n${body}\n`])),
};
const isCommand=(topic?:string)=>!topic||commands.some(command=>command.name===topic||command.aliases?.includes(topic));
/** One bundled documentation set: help, the manual and the installed skills render the same registry. */
export function helpDocument(topic?:string,format='text'):string{
 if(format==='man'){
  if(!isCommand(topic))throw new CliError('unsupported_format',`The manual documents commands, not the ${topic} topic.`,'Read topic guidance with --format text or markdown.');
  return manPage(topic);
 }
 if(!isCommand(topic)){
  const text=helpTopics[topic as string];
  if(text===undefined)throw new CliError('unknown_help_topic',`Unknown help topic ${topic}.`,'Run afbin help.');
  return text;
 }
 if(format!=='markdown')return commandHelp(topic);
 const section=(name:string,heading:string)=>`${heading}\n\n\`\`\`text\n${commandHelp(name)}\`\`\`\n`;
 if(topic)return section(topic,`# afbin ${topic}`);
 return `# afbin\n\nLocal files and published artifacts. Every command is offline unless it names a remote resource.\n\n`
  +commands.map(command=>section(command.name,`## ${command.name}`)).join('\n');
}
/** --output never replaces an existing file: help has no overwrite permission. */
export async function writeHelp(text:string,destination:string,cwd:string,format:string):Promise<{format:string;output:string;bytes:number}>{
 const path=resolve(cwd,destination);
 if(await readOptional(path)!==null)throw new CliError('destination_exists',`${destination} already exists.`,'Choose a free destination; afbin help never replaces a file.');
 await atomicWrite(path,text);
 return {format,output:path,bytes:Buffer.byteLength(text)};
}
