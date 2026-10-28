/** Retired executable assets stay inaccessible even when old files remain on disk. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe,expect,it} from 'vitest';
import {createAppServer} from '@/server/app';
describe('retired executable installers',()=>{
 it('refuses executable entry points and stale static files',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retired-installer-'));
  try {
   fs.mkdirSync(path.join(dir,'chat'));fs.writeFileSync(path.join(dir,'chat/install.sh'),'#!/bin/sh\necho stale');
   const app=createAppServer({indexHtml:async()=>'<div>SPA</div>',publicDir:dir});
   for(const route of ['/install.sh','/chat/install.sh','/chat/install.ps1','/chat/uninstall.sh','/chat/ensure-node.sh','/chat/ensure-node.ps1','/chat/install-node.sh','/chat/install-node.ps1','/chat/releases/stale']){
    const response=await app.request(route);expect(response.status,route).toBe(404);expect(await response.text()).not.toContain('echo stale');
   }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
 });
});
