/** Build-only projection: authoring references + executable command/operation registries. */
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync,renameSync,rmSync,rmdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {manPage} from '../src/man';
import {buildSkillTree,loadSkillSources} from '../../app/lib/skills/tree';
import {skillFileWithFrontmatter} from '../../app/lib/skills/serve';
import {skillExample,renderSkill,condenseForBundle,stripBundleMarkers} from '../../app/lib/skills/render';
import {CLI_PROTOCOL_VERSION} from '@artifactbin/contracts';
import {TEACHING_BASE,TEACHING_CREDENTIAL_PATH} from '../src/teaching-origin';
const root=fileURLToPath(new URL('../',import.meta.url));
// NOT an origin: the bundle ships addressed to nobody and the CLI substitutes
// the SELECTED server when it installs the skill or prints a reference
// (src/teaching-origin). A literal here would teach every self-hoster's agent
// to talk to one particular deployment.
const BASE=TEACHING_BASE;
const example=skillExample();
// The authoring compiler must never import the index that consumes its output.
// Retire generated executables from existing checkouts before checking the source tree.
const retiredScripts=join(root,'../app/skills/artifactbin/scripts');
for(const name of ['credentials.mjs','watch-comments.mjs'])rmSync(join(retiredScripts,name),{force:true});
if(existsSync(retiredScripts)&&readdirSync(retiredScripts).length===0)rmdirSync(retiredScripts);
const tree=buildSkillTree(loadSkillSources());
const brief=tree.get('artifactbin/SKILL.md');
if(!brief)throw new Error('skills/artifactbin/SKILL.md is missing');
// The brief keeps its frontmatter: the harness preloads the name and description, then loads the body on trigger.
const files:Record<string,string>={'SKILL.md':skillFileWithFrontmatter(brief,renderSkill(brief,{base:BASE,credentialPath:TEACHING_CREDENTIAL_PATH,transport:'cli'}))};
/**
 * The SECOND length of a reference that carries `<!--bundle:skip-->` spans: what `afbin help
 * <template>` concatenates, without the rationale a single-file read can afford. Only files that
 * actually mark something appear here, so the bundle carries no duplicate of an unmarked file.
 */
const condensed:Record<string,string>={};
for(const file of tree.files){
 if(!file.ref||file.audience!=='agent')continue;
 const path=`references/${file.file}`;
 files[path]=skillFileWithFrontmatter(file,renderSkill(file,{base:BASE,credentialPath:TEACHING_CREDENTIAL_PATH,transport:'cli'}));
 const short=renderSkill(file,{base:BASE,credentialPath:TEACHING_CREDENTIAL_PATH,bundle:true,transport:'cli'});
 if(short!==renderSkill(file,{base:BASE,credentialPath:TEACHING_CREDENTIAL_PATH,transport:'cli'}))condensed[path]=short;
}
for(const [path,text] of Object.entries(files)){
 if(!text.includes('bundle:skip'))continue;
 condensed[path]=condenseForBundle(text);
 files[path]=stripBundleMarkers(text);
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
