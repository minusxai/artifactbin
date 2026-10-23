import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
/** Explicit text-only package resources. Request input never chooses filesystem paths. */
export type SkillPackageAssets=Readonly<Record<string,string>>;
export const skillAssetName=(name:string):boolean=>/^(?:scripts\/[a-z0-9-]+\.mjs|examples\/[a-z0-9-]+\.(?:html|csv|ts)|design-systems\/[a-z0-9-]+\.css)$/.test(name);
export function loadSkillAssets(root=path.resolve(process.cwd(),'skills/artifactbin')):SkillPackageAssets{
 const files:Record<string,string>={};
 for(const directory of ['scripts','examples','design-systems']){
  let names:string[];try{names=readdirSync(path.join(root,directory));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
  for(const name of names){const relative=`${directory}/${name}`;if(!skillAssetName(relative))throw Error(`Unsupported skill asset: ${relative}`);files[relative]=readFileSync(path.join(root,relative),'utf8');}
 }
 return files;
}
