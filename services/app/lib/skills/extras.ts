/**
 * DEPLOYMENT EXTRAS (`SKILLS__EXTRA_DIR`, off by default): files an operator adds to the author skill this origin
 * serves, for a deployment whose co-hosted services need their own guide and script beside the product's.
 *
 * They ship under `extras/` and nowhere else, so they never shadow or replace a product file, and the release
 * version covers them (package.ts `skillRelease` hashes every member), so installed skills update when they change.
 * The directory is flat and holds only lowercase kebab-case `.md` guides, `.mjs` scripts and `.json` data: no
 * hidden files, subdirectories or symlinks, UTF-8 text, at most EXTRAS_MAX_FILES files, EXTRA_FILE_MAX_BYTES each
 * and EXTRAS_MAX_BYTES together (a cap of their own: the product archive's budget is unchanged). Nothing here is
 * templated or executed by the server; a script runs only when an agent runs it.
 *
 * TRUST: extras are operator-supplied instructions and code delivered to agents, and public (anyone may download
 * the archive): no secrets. An origin may enable them only once its installs run an updater that accepts
 * `extras/` (scripts/toolbox-update-archive.mjs); an older one refuses the release and keeps its current skill.
 *
 * Discovery: the generated `extras/README.md` lists each guide by its first `# ` heading (required) and its
 * `Read when …` line (optional, the first line starting so), and SKILL.md points at it only when extras exist.
 * A script may import the skill's own modules by relative path (`../scripts/…`), relying only on
 * EXTRA_ENTRY_POINTS.
 */
import {lstatSync,readdirSync,readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {skillExtrasDir} from '@/lib/platform';

export const EXTRA_FILE_MAX_BYTES=64*1024;
export const EXTRAS_MAX_BYTES=256*1024;
export const EXTRAS_MAX_FILES=32;
/** The skill modules an extra's script may import, and the exported names it may rely on (pinned by a test). */
export const EXTRA_ENTRY_POINTS={
 'scripts/toolbox-client.mjs':['makeClient','selectedServer','credentialRoot','runTool','ToolError'],
 'scripts/toolbox-service-token.mjs':['serviceToken'],
 'scripts/toolbox-config.mjs':['default'],
} as const;
const SOURCE_NAME=/^[a-z0-9-]+\.(?:md|mjs|json)$/;
/** An archive member the extras may occupy: an operator file, or the generated index. */
export const skillExtraName=(name:string):boolean=>/^extras\/(?:(?!readme\.)[a-z0-9-]+\.(?:md|mjs|json)|README\.md)$/.test(name);
export interface SkillExtras {readonly dir:string;readonly files:Readonly<Record<string,string>>}

/** Read and validate the directory now; throws naming SKILLS__EXTRA_DIR on anything it would not ship. */
export function readSkillExtras(dir:string):SkillExtras{
 const fail=(problem:string):never=>{throw new Error(`[boot] SKILLS__EXTRA_DIR ${JSON.stringify(dir)}: ${problem}. Fix it or unset the setting.`);};
 let names:string[]=[];
 try{if(!statSync(dir).isDirectory())fail('is not a directory');names=readdirSync(dir).sort();}
 catch(error){if((error as Error).message.startsWith('[boot]'))throw error;fail(`cannot be read (${(error as NodeJS.ErrnoException).code??'error'})`);}
 if(!names.length)fail('is empty');
 if(names.length>EXTRAS_MAX_FILES)fail(`holds ${names.length} files, more than ${EXTRAS_MAX_FILES}`);
 const files:Record<string,string>={},guides:string[]=[],others:string[]=[];let total=0;
 for(const name of names){
  if(name.startsWith('.'))fail(`${name}: hidden files are not shipped`);
  const stat=lstatSync(path.join(dir,name));
  if(stat.isSymbolicLink())fail(`${name}: symlinks are not shipped`);
  if(!stat.isFile())fail(`${name}: only files are shipped, no subdirectories`);
  if(!SOURCE_NAME.test(name)||name.startsWith('readme.'))fail(`${name}: names are lowercase [a-z0-9-] ending .md, .mjs or .json (readme is the generated index)`);
  if(stat.size>EXTRA_FILE_MAX_BYTES)fail(`${name}: ${stat.size} bytes, more than ${EXTRA_FILE_MAX_BYTES}`);
  if((total+=stat.size)>EXTRAS_MAX_BYTES)fail(`more than ${EXTRAS_MAX_BYTES} bytes together`);
  let text='';
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path.join(dir,name)));}catch{fail(`${name}: not UTF-8 text`);}
  if(text.includes('\0'))fail(`${name}: not text`);
  if(name.endsWith('.json'))try{JSON.parse(text);}catch{fail(`${name}: not valid JSON`);}
  if(name.endsWith('.md')){
   const title=/^# +(\S.*)$/m.exec(text)?.[1]?.trim();if(!title)fail(`${name}: a guide needs a "# " heading`);
   const when=/^Read when\b.*$/m.exec(text)?.[0]?.trim();
   guides.push(`- [${title}](${name})${when?`: ${when}`:''}`);
  }else others.push(`\`${name}\``);
  files[`extras/${name}`]=text;
 }
 files['extras/README.md']=['# Extras from this server','',
  'Guides and scripts this server\'s operator added to the skill; they are not Artifactbin\'s own. A script runs',
  'only when you run it (`node extras/<name>.mjs`).','',...guides,...(others.length?['',`Scripts and data: ${others.join(', ')}.`]:[]),''].join('\n');
 return {dir,files};
}

let cached:{dir:string;extras:SkillExtras}|null=null;
/** This origin's extras, read once per setting value (the boot reads them first), or null when the setting is off. */
export function skillExtras():SkillExtras|null{
 const dir=skillExtrasDir();
 if(!dir)return null;
 if(cached?.dir!==dir)cached={dir,extras:readSkillExtras(dir)};
 return cached.extras;
}
