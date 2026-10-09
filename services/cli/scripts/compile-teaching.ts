/** Build-only projection: authoring references + executable command/operation registries. */
import {readFileSync,mkdirSync,writeFileSync,existsSync,renameSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {manPage} from '../src/man';
import {buildSkillTree,loadSkillSources} from '../../app/lib/skills/tree';
import {skillFileWithFrontmatter} from '../../app/lib/skills/serve';
import {skillExample,renderSkill,condenseForBundle,stripBundleMarkers} from '../../app/lib/skills/render';
import {build} from 'esbuild';
import {CLI_PROTOCOL_VERSION} from '@artifactbin/contracts';
import {TEACHING_BASE} from '../src/teaching-origin';
const root=fileURLToPath(new URL('../',import.meta.url));
// NOT an origin: the bundle ships addressed to nobody and the CLI substitutes
// the SELECTED server when it installs the skill or prints a reference
// (src/teaching-origin). A literal here would teach every self-hoster's agent
// to talk to one particular deployment.
const BASE=TEACHING_BASE;
const example=skillExample();
// The authoring compiler must never import the index that consumes its output.
const tree=buildSkillTree(loadSkillSources());
const brief=tree.get('artifactbin/SKILL.md');
if(!brief)throw new Error('skills/artifactbin/SKILL.md is missing');
// The brief keeps its frontmatter: the harness preloads the name and description, then loads the body on trigger.
const files:Record<string,string>={'SKILL.md':skillFileWithFrontmatter(brief,renderSkill(brief,{base:BASE}))};
/**
 * The SECOND length of a reference that carries `<!--bundle:skip-->` spans: what `afbin help
 * <template>` concatenates, without the rationale a single-file read can afford. Only files that
 * actually mark something appear here, so the bundle carries no duplicate of an unmarked file.
 */
const condensed:Record<string,string>={};
for(const file of tree.files){
 if(!file.ref||file.audience!=='agent')continue;
 const path=`references/${file.file}`;
 files[path]=skillFileWithFrontmatter(file,renderSkill(file,{base:BASE}));
 const short=renderSkill(file,{base:BASE,bundle:true});
 if(short!==renderSkill(file,{base:BASE}))condensed[path]=short;
}
for(const [path,text] of Object.entries(files)){
 if(!text.includes('bundle:skip'))continue;
 condensed[path]=condenseForBundle(text);
 files[path]=stripBundleMarkers(text);
}
// This asset is generated from the credential runtime, never maintained as a second implementation.
const helperSource=join(root,'../utils/src/credential-helper.ts');
{
 const bundled=await build({entryPoints:[helperSource],bundle:true,platform:'node',format:'esm',target:'node22',write:false});
 const helper=bundled.outputFiles[0]!.text;
 files['scripts/credentials.mjs']=helper;
 const helperTarget=join(root,'../app/skills/artifactbin/scripts/credentials.mjs');
 if(process.argv.includes('--check')){if(!existsSync(helperTarget)||readFileSync(helperTarget,'utf8')!==helper)throw new Error('Shared credential helper is missing or stale; run generate:teaching.');}
 else{mkdirSync(dirname(helperTarget),{recursive:true});if(!existsSync(helperTarget)||readFileSync(helperTarget,'utf8')!==helper)writeFileSync(helperTarget,helper);}
}
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
const contents=JSON.stringify({version,protocol:CLI_PROTOCOL_VERSION,files,condensed,example,man:manPage()},null,2)+'\n';
const target=join(root,'src/generated/teaching.json');
const previous=existsSync(target)?readFileSync(target,'utf8'):null;
if(process.argv.includes('--check')){if(previous!==contents)throw new Error('Bundled teaching is missing or stale; run npm run generate:teaching -w services/cli.');}
else if(previous!==contents){
 mkdirSync(dirname(target),{recursive:true});
 // Readers see a complete bundle; unchanged runs leave watcher timestamps alone.
 const temporary=`${target}.${process.pid}.tmp`;
 try{writeFileSync(temporary,contents);renameSync(temporary,target);}
 finally{rmSync(temporary,{force:true});}
}
console.log(`Generated local teaching: ${Object.keys(files).length} files, ${Buffer.byteLength(contents)} bytes.`);
