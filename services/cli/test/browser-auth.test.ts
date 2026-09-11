import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserAuthenticate, deviceAuthenticate, ApprovalRequired } from '../src/browser-auth';
import {CliError} from '../src/commands';
import { loadConnection } from '../src/config';

test('unattended pairing reports approval, resumes, and persists credentials without a validation GET', async () => {
  const home = await mkdtemp(join(tmpdir(), 'afbin-pair-'));
  const calls: string[] = [];
  let approved = false;
  const request: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === '/oauth/device') return Response.json({device_code:'d'.repeat(43),user_code:'1234-5678-ABCD-EF12', verification_uri_complete:'https://example.com/oauth/device?user_code=1234-5678-ABCD-EF12',expires_in:300,interval:5});
    if (path === '/oauth/device/token') return approved
      ? Response.json({access_token:'mx_access', refresh_token:'mxr_refresh', client_id:'afbin_client',expires_in:21600})
      : Response.json({error:'authorization_pending'}, {status:400});
    throw new Error(`Unexpected request ${path}`);
  };
  try {
    await assert.rejects(browserAuthenticate('https://example.com', {home, fetch:request, interactive:false}), error => {
      assert.ok(error instanceof ApprovalRequired);
      assert.match(error.verificationUrl, /user_code=/);
      assert.ok(!error.message.includes('d'.repeat(43)));
      return true;
    });
    assert.equal((await stat(join(home,'.artifactbin'))).mode & 0o777, 0o700);
    approved = true;
    const connection = await browserAuthenticate('https://example.com', {home, fetch:request, interactive:false});
    assert.equal(connection.token,'mx_access');
    assert.deepEqual(await loadConnection(undefined,home,{}),connection);
    assert.equal(calls.filter(x=>x==='/oauth/device').length,1);
    assert.ok(calls.every(x=>x.startsWith('/oauth/')));
  } finally {await rm(home,{recursive:true,force:true});}
});

test('interactive flow opens the browser and bounded polling never implies approval', async () => {
  const home = await mkdtemp(join(tmpdir(),'afbin-pair-'));
  let now = 1000;
  let opened = 0;
  const request: typeof fetch = async input => String(input).endsWith('/oauth/device')
    ? Response.json({device_code:'d'.repeat(43), user_code:'code', verification_uri_complete:'https://example.com/oauth/device?user_code=code', expires_in:10, interval:5})
    : Response.json({error:'authorization_pending'}, {status:400});
  try {
    await assert.rejects(deviceAuthenticate('https://example.com',{home,fetch:request,interactive:true,now:()=>now,sleep:async ms=>{now+=ms;},open:async()=>{opened++;},notify:()=>{}}),(error:unknown)=>error instanceof CliError&&error.code==='approval_expired');
    assert.equal(opened,1);
    assert.equal(now,11000);
    assert.equal(await loadConnection(undefined,home,{}),null);
  } finally {await rm(home,{recursive:true,force:true});}
});

test('device denial has a stable error code and leaves no credentials',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-denied-'));
 try{
  await assert.rejects(deviceAuthenticate('https://example.com',{home,interactive:false,fetch:async input=>String(input).endsWith('/oauth/device')
   ?Response.json({device_code:'d'.repeat(43),user_code:'code',verification_uri_complete:'https://example.com/oauth/device?user_code=code',expires_in:300,interval:5})
   :Response.json({error:'access_denied'},{status:400})}),error=>error instanceof CliError&&error.code==='access_denied');
  assert.equal(await loadConnection(undefined,home,{}),null);
 }finally{await rm(home,{recursive:true,force:true});}
});
