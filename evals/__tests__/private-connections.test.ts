import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {it,expect} from 'vitest';
import {privateConnectionPaths} from '../lib/private-connections';
it('protects the entire current configuration directory and any old credentials left on disk',()=>{
 const home=mkdtempSync(join(tmpdir(),'eval-private-'));
 try{
  expect(privateConnectionPaths(home)).toEqual([]);
  mkdirSync(join(home,'.artifactbin'));writeFileSync(join(home,'.artifactbin.env'),'');
  expect(privateConnectionPaths(home)).toEqual([join(home,'.artifactbin'),join(home,'.artifactbin.env')]);
 }finally{rmSync(home,{recursive:true,force:true});}
});
