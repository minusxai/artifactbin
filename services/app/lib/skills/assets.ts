import {lstatSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
/** Explicit text-only package resources. Request input never chooses filesystem paths.
 * Components are flat lowercase kebab-case readable .ts sources only: pages import the compiled modules from the
 * platform as `@afbin/<component>` (D20). Component .test.ts and .fixture.ts files are development-only and never exported. */
export type SkillPackageAssets=Readonly<Record<string,string>>;
export const skillAssetName=(name:string):boolean=>/^(?:scripts\/[a-z0-9-]+\.mjs|examples\/[a-z0-9-]+\.(?:html|csv|ts)|design-systems\/[a-z0-9-]+\.css|components\/[a-z0-9-]+\.ts)$/.test(name);
export function loadSkillAssets(root=path.resolve(process.cwd(),'skills/artifactbin')):SkillPackageAssets{
 const files:Record<string,string>={};
 for(const directory of ['scripts','examples','design-systems','components']){
  let names:string[];try{if(directory==='components'&&!lstatSync(path.join(root,directory)).isDirectory())throw Error('Unsupported skill asset: '+directory);names=readdirSync(path.join(root,directory));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  for(const name of names){const relative=`${directory}/${name}`;if(directory==='components'&&/^[a-z0-9-]+\.(?:test|fixture)\.ts$/.test(name))continue;if(!skillAssetName(relative)||directory==='components'&&!lstatSync(path.join(root,relative)).isFile())throw Error(`Unsupported skill asset: ${relative}`);files[relative]=readFileSync(path.join(root,relative),'utf8');}
 }
 return files;
}
