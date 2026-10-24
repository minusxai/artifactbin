/** Package-owned font bytes only: the manifest admits paths, never requests or authored HTML. */
import {lstatSync,readFileSync} from 'node:fs';
import path from 'node:path';
import manifest from '../data/story/story-font-manifest.json';
import {skillFontMemberName,type SkillPackageAssets} from './assets';
export interface SkillFontFiles {readonly [name:string]:Uint8Array}
const registered=new Set(Object.values(manifest.systems).flat().map(face=>face.url));
export function skillFontFiles(assets:SkillPackageAssets):SkillFontFiles{
 const urls=new Set<string>();
 for(const [name,css]of Object.entries(assets))if(/^design-systems\/[a-z0-9-]+\.css$/.test(name)){
  for(const match of css.matchAll(/src:\s*url\(\s*["']?([^"'\s)]+)/g)){
   const member=match[1]!.replace(/^\.\.\//,'');
   if(!match[1]!.startsWith('../fonts/')||!skillFontMemberName(member)||!registered.has('/'+member))throw Error('Unsupported skill font reference: '+match[1]);
   urls.add(member);
  }
 }
 return Object.fromEntries([...urls].sort().map(member=>{
  // Same package-cwd public directory as production static serving; bundling cannot relocate it.
  const file=path.resolve('public',member);
  if(!lstatSync(path.resolve('public/fonts')).isDirectory()||lstatSync(path.resolve('public/fonts')).isSymbolicLink()||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw Error('Unsupported skill font file');
  return [member,new Uint8Array(readFileSync(file))];
 }));
}
