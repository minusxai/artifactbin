import {expect,it} from 'vitest';
import {cpSync,mkdtempSync,readdirSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {skillTree} from '../index';
import {loadSkillAssets} from '../assets';
import {skillPackageFiles,skillZip} from '../package';
import {componentFile} from '../../libraries/components.server';

/** What the production image copies from the app package (artifactbin-server source-runtime copyAppAssets). */
const IMAGE=['public','skills','dist/web','lib/build-assets'];
const dirs=(root:string):string[]=>[root,...readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()).flatMap(entry=>dirs(path.join(root,entry.name)))];

it('packs the skill zip from only what the production image ships, with every directory readable by another user',()=>{
 const image=mkdtempSync(path.join(tmpdir(),'skill-image-'));
 try{
  for(const relative of IMAGE.filter(entry=>['skills','lib/build-assets'].includes(entry)).map(entry=>entry==='lib/build-assets'?'lib/build-assets/components':entry))cpSync(path.resolve(relative),path.join(image,relative),{recursive:true});
  // Image builds keep the build tree's modes (a copy here would not), so check the tree they copy.
  for(const relative of ['skills','lib/build-assets/components'])for(const dir of dirs(path.resolve(relative)))expect(statSync(dir).mode&0o005,dir).toBe(0o005);
  const files=skillPackageFiles(skillTree(),'https://app.example',loadSkillAssets(path.join(image,'skills/artifactbin')));
  expect(Object.keys(files).filter(name=>name.startsWith('components/')).length).toBeGreaterThan(20);
  expect(skillZip(files).byteLength).toBeGreaterThan(1000);
  // The hosted modules the app serves are inside the image's lib/build-assets.
  expect(componentFile('tabs.js')).toBe('tabs.js');
  expect(readdirSync(path.join(image,'lib/build-assets/components'))).toContain('tabs.js');
 }finally{rmSync(image,{recursive:true,force:true});}
});
