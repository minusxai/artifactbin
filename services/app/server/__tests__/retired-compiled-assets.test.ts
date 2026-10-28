import {expect,it} from 'vitest';
import {objectStore} from '@/lib/object-store';
import {useAppHarness} from '@/__tests__/harness';
useAppHarness();
import {createAppServer} from '../app';

it('does not expose retired compiled document resource routes',async()=>{
 for(const prefix of ['islands','islands/t','islands/c','islands/s'])await objectStore().put(`${prefix}/0123456789abcdef`,Buffer.from('{}'),'application/json');
 const app=createAppServer({indexHtml:async()=>'<html><head></head><body></body></html>'});
 for(const path of ['/islands/d/0123456789abcdef.js','/islands/t/0123456789abcdef.json','/islands/c/0123456789abcdef.css','/islands/s/0123456789abcdef.json']){
  const response=await app.request(`https://app.example.test${path}`);
  expect(response.status,path).toBe(404);
 }
});
