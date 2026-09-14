import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createTrialTransport, trialArtifactId, trialUpstreamUrl, writeTrialError } from '../lib/mx-trials/transport';
import { runDataflow } from '../../services/app/lib/sql/run-dataflow';
import { validateMarkupStructure } from '../../services/app/lib/story/local-validation';
import { fixtureMarkup, sessionVerdict } from '../lib/mx-trials/tasks.mjs';

it('pins the relay origin and rejects authority and malformed request targets', () => {
  expect(trialUpstreamUrl('/api/browser-sessions?x=1').href).toBe('http://127.0.0.1:3391/api/browser-sessions?x=1');
  for (const target of ['@evil.test/', '//evil.test/', '/\\evil.test/', 'http://evil.test/', '', '/a\r\nb']) {
    expect(() => trialUpstreamUrl(target), target).toThrow();
  }
});

it('rejects non-ID response values before they reach a harness command', () => {
  expect(trialArtifactId('Abc123')).toBe('Abc123');
  for (const value of ['abc123; echo bad', '--help', '../abc123', '<script>', null, {}, 123456]) {
    expect(() => trialArtifactId(value)).toThrow();
  }
});

it('serves generic errors as non-sniffable text, never HTML or exception details', async () => {
  const server = createServer((_req, res) => writeTrialError(res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test listener');
    const response = await fetch(`http://127.0.0.1:${address.port}`);
    expect(response.status).toBe(502);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('Trial upstream request failed');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it('forwards only the path to the fixed local socket and preserves bodies, cookies and redirects', async () => {
  const seen: unknown[] = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen.push({url:req.url,method:req.method,body:Buffer.concat(chunks).toString(),encoding:req.headers['accept-encoding']});
    res.writeHead(302, {'location':'http://external.invalid/', 'set-cookie':['one=1; Path=/','two=2; Path=/']});
    res.end('redirect body');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address=server.address();
    if(!address || typeof address==='string') throw new Error('No test listener');
    const send=createTrialTransport(address.port);
    const response=await send('/api/browser-sessions?probe=1',{method:'POST',headers:{'content-type':'text/plain','accept-encoding':'gzip'},body:Buffer.from('payload')});
    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie()).toEqual(['one=1; Path=/','two=2; Path=/']);
    expect(await response.text()).toBe('redirect body');
    await expect(send('//external.invalid/',{method:'GET',headers:{}})).rejects.toThrow();
    expect(seen).toEqual([{url:'/api/browser-sessions?probe=1',method:'POST',body:'payload',encoding:'identity'}]);
  } finally {
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
it('rejects self-reported success when the observed state or write count is wrong', () => {
  const page = {url:'/a/abcdef',signals:{region:{value:'North'},taskTitle:{value:'untouched'},tasks:{value:{rows:[{title:'Existing'}]}}}};
  const evidence = {pages:[page],executions:[{session_id:'one',result:'NOT_WRITABLE'}],sourceChanged:false};
  expect(sessionVerdict('invalid',evidence).passed).toBe(true);
  expect(sessionVerdict('invalid',{...evidence,pages:[{...page,signals:{...page.signals,region:{value:'South'}}}]}).passed).toBe(false);
  expect(sessionVerdict('invalid',{...evidence,sourceChanged:true}).noUnintendedWrites).toBe(false);
  expect(sessionVerdict('mutate',{...evidence,executions:[{result:'committed'}]}).passed).toBe(false);
});

it('uses a publishable real-runtime fixture', () => {
  expect(validateMarkupStructure(fixtureMarkup('')).errors).toEqual([]);
});

it('the fixture produces ready rows and an intentional query error', async () => {
  const {content} = validateMarkupStructure(fixtureMarkup('')).split!;
  const flow = {values:content.values,queries:content.queries,mutations:content.mutations};
  const ready = await runDataflow(flow, {});
  expect(ready.errors).toEqual({});
  expect(ready.tables.sales.rows).toEqual([{name:'North total',revenue:110}]);
  const broken = await runDataflow(flow, {}, {values:{region:'Broken'}});
  expect(broken.errors.sales).toMatch(/convert|cast|invalid/i);
});

it('identifies duplicate artifacts independently of signal query parameters', () => {
  const page = {signals:{region:{value:'North'},taskTitle:{value:'untouched'},tasks:{value:{rows:[{title:'Existing'}]}}}};
  const receipt={session_id:'session',pages:[{page_id:'one'},{page_id:'two'}]};
  const evidence={pages:[{...page,url:'http://app/@owner/abcdef',id:'one'},{...page,url:'http://app/@owner/abcdef?$region=South',id:'two',signals:{...page.signals,region:{value:'South'}}}],executions:[receipt,receipt],sourceChanged:false};
  expect(sessionVerdict('duplicate',evidence).passed).toBe(true);
  expect(sessionVerdict('duplicate',{...evidence,pages:[evidence.pages[0],{...evidence.pages[1],url:'http://app/@owner/ghijkl'}]}).passed).toBe(false);
});

it('grades page continuity without counting a failed attempt that never created a page', () => {
  const page={id:'page',url:'/a/abcdef',marker:'still-here',signals:{region:{value:'South'},taskTitle:{value:'untouched'},tasks:{value:{rows:[{title:'Existing'}]}}}};
  const receipt={session_id:'session',pages:[{page_id:'page'}],status:'completed',result:{marker:'still-here'}};
  const evidence={pages:[page],sourceChanged:false,executions:[{session_id:'unused',status:'failed',pages:[]},receipt,receipt]};
  expect(sessionVerdict('resume',evidence).passed).toBe(true);
});

it('rejects recreated pages even if they share a session and claim the same marker', () => {
  const page={id:'page',url:'/a/abcdef',marker:'still-here',signals:{region:{value:'South'},taskTitle:{value:'untouched'},tasks:{value:{rows:[{title:'Existing'}]}}}};
  const receipt={session_id:'session',pages:[{page_id:'page'}],status:'completed',result:{marker:'still-here'}};
  const evidence={pages:[page],sourceChanged:false,executions:[{...receipt,pages:[{page_id:'old-page'}]},receipt]};
  expect(sessionVerdict('resume',evidence).passed).toBe(false);
});

it('can build session fixtures without inert iframe controls', () => {
  expect(fixtureMarkup('',false)).not.toContain('<Iframe');
  expect(fixtureMarkup('',false)).toContain('Host region');
});

it('accepts recorded signal values without requiring one serialization shape', () => {
  const page={url:'/a/abcdef',signals:{region:{value:'South'},taskTitle:{value:'untouched'},tasks:{value:{rows:[{title:'Existing'}]}}},observed:[{value:'North',status:'ready'},{value:'South',status:'ready'}]};
  const evidence={pages:[page],executions:[],sourceChanged:false,subscriptionStopped:true};
  expect(sessionVerdict('subscribe',evidence).passed).toBe(true);
  expect(sessionVerdict('subscribe',{...evidence,subscriptionStopped:false}).passed).toBe(false);
  for (const observed of [['South'],[{region:'South'}],[{region:{value:'South'}}],[{signals:{region:{value:'South'}}}]]) {
    expect(sessionVerdict('subscribe',{...evidence,pages:[{...page,observed}]}).passed).toBe(true);
  }
  expect(sessionVerdict('subscribe',{...evidence,pages:[{...page,observed:[{unrelated:'South'}]}]}).passed).toBe(false);
});
