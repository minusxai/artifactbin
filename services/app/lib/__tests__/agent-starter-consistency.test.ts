/** Every discovery surface names npm afbin; CLI starters retain their auth loop,
 * while direct HTTP discovery teaches verified email issuance and graph claims.
 * Retired endpoints/brands remain forbidden on every surface. */
import {isPublicSkillTopic} from '@/lib/skills/public-surface';
import { describe, expect, it } from 'vitest';
import { monitoringGuidance } from '@/lib/artifacts/monitoring-guidance';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { agentContract } from '@/lib/serving';
import { agentBlurb, existingPaste } from '@/lib/serving';
import { DEFAULT_SERVER } from '@artifactbin/contracts';
import { gettingStarted } from '@/lib/serving/getting-started';
import { publicGuideText, llmsText } from '@/lib/serving/agent-references.server';
import { GET as guideRoute } from '@/app/llms/[topic]/route';
import { renderSkill } from '@/lib/skills/render';
import { AGENT_HELP_TITLE, agentDiscovery, agentDiscoveryHead } from '@/lib/serving/agent-discovery';
import { createArtifact } from '@/lib/artifacts';
import { MARKDOWN_CONTENT_TYPE, unauthorized } from '@/lib/http';
import {projectSkillLinks} from '@/lib/skills/serve';
import { skillExample, skillTree } from '@/lib/skills';
import { buildQuickSheet, QUICK_SHEET_MAX_BYTES } from '@/test/helpers/skill-docs';
import { createUser, mintToken } from '@/lib/accounts';
import { POST as createCommentRoute, GET as listCommentsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { PATCH as editCommentRoute, POST as actOnCommentRoute } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { createBrowserSessions } from '../../../browser/src/sessions';
import type { Actor, BrowserSessionRequest } from '@artifactbin/contracts';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const legacyGuideText=(topic:string,base:string)=>{const file=skillTree().get(`artifactbin/references/${topic}.md`)!;return projectSkillLinks(file,renderSkill(file,{base,transport:'http'}),base);};
/** The retired vocabulary. Each of these, in an agent's hands, is a wrong turn. */
const RETIRED = ['paste', 'tokens/new', 'tokens/anonymous', 'MCP', '/raw', '/docs/'];
const CLI_ONLY_RETIRED = ['mint','claim'];
const httpDiscovery=(name:string)=>name==='the 401 hint'||name==='skills/artifactbin/llms.txt'||name==='skills/artifactbin/SKILL.md'||name==='lib/compiled-page/agent-discovery meta';

/** The single sanctioned mention: a prohibition the skill is allowed to spell out, once. */
const ALLOWED_SENTENCE = 'never mint or print tokens';

let seq = 0;
const surfaces = async (): Promise<Array<[name: string, text: string]>> => {


  // A fresh account per call: the harness wipes between TESTS, not between
  // calls inside one.
  const email = `starter-consistency-${seq++}@example.com`;
  const user = await createUser({ email });
  const owned = await createArtifact('', user.id, { format: 'markup', source: '<h1>Owned</h1>', content: '<h1>Owned</h1>', meta: {} } as never);
  const actor = { credential: 'session' as const, userId: user.id, email, emailVerified: true };
  const started = await (await startRoute(request('/api/start', { method: 'POST', actor }))).json() as { prompt: string };
  const handed = await (await agentPromptRoute(
    request(`/api/my/artifacts/${owned.id}/agent-prompt`, { method: 'POST', actor }),
    { params: Promise.resolve({ id: owned.id }) },
  )).json() as { prompt: string };

  const refused = await (await unauthorized(new Request(`${BASE}/api/artifacts`))).json() as { help: string };

  return [
    ['lib/agent-copy existingPaste', existingPaste(BASE, 'ab3cd9')],
    ['POST /api/start prompt', started.prompt],
    ['POST /api/my/artifacts/:id/agent-prompt prompt', handed.prompt],
    ['skills/artifactbin/SKILL.md', llmsText(BASE)],
    ['skills/artifactbin/llms.txt', llmsText(BASE)],
    ['lib/compiled-page/agent-discovery meta', agentDiscovery(BASE).instruction],
    ['lib/agent-contract', agentContract(BASE)],
    ['the 401 hint', refused.help],
  ];
};

/** (c) is applied to the text with the ONE sanctioned sentence removed — once, exactly. */
const withoutTheException = (text: string): string => text.replace(ALLOWED_SENTENCE, '');

describe('every agent-facing starter says the same thing', () => {
  it('links the author skill and HTTP guide without CLI setup',async()=>{
    for(const [name,text] of await surfaces()){
      expect(text,name).toContain(name==='the 401 hint'||name.startsWith('skills/')?`${BASE}/llms/http-auth`:`${BASE}/llms.txt`);
      expect(text,name).not.toMatch(/afbin |@afbin\/cli|chat\/install/);
    }
  });
  it('(c) names none of the retired vocabulary', async () => {
    const offences: string[] = [];
    for (const [name, text] of await surfaces()) {
      const scanned = withoutTheException(text).toLowerCase();
      for (const word of [...RETIRED,...(httpDiscovery(name)?[]:CLI_ONLY_RETIRED)]) if (scanned.includes(word.toLowerCase())) offences.push(`${name}: "${word}"`);
    }
    expect(offences).toEqual([]);
  });

  it('direct HTTP discovery requires email and teaches the real scoped bearer and graph contract',()=>{
    const guide=publicGuideText('http-auth',BASE)!;
    expect(guide).toContain('HTTP authentication requires an email account');
    expect(guide).toContain('/api/authentication/token');
    expect(guide).toContain('Authorization: Bearer <access_token>');
    expect(llmsText(BASE)).toContain(`${BASE}/llms/html-authoring`);
    expect(publicGuideText('html-authoring',BASE)).toContain('expectedState');
  });

  it('native HTTP discovery routes to authoring and runtime without command setup',()=>{
    expect(llmsText(BASE)).toContain(`${BASE}/llms/html-authoring`);
    expect(llmsText(BASE)).toContain(`${BASE}/llms/html-runtime`);
    expect(llmsText(BASE)).not.toContain('afbin pull');
  });

  it('the ONE exception is the skill\'s prohibition, spelled exactly and only once', () => {
    const skill = buildQuickSheet(BASE);
    expect(skill.split(ALLOWED_SENTENCE)).toHaveLength(2);
    // And it is a prohibition, not an offer: nothing around it tells an agent where to get one.
    expect(withoutTheException(skill).toLowerCase()).not.toMatch(/mint.*token|print.*token|tokens\/new/);
  });

  it('the starter includes the question for the user and is identical everywhere it is handed over', async () => {
    const all = await surfaces();
    const [, started] = all.find(([name]) => name === 'POST /api/start prompt')!;
    const [, handed] = all.find(([name]) => name.includes('agent-prompt'))!;
    expect(started).toContain("\n\nIf the user hasn't specified a task, ask what artifact they'd like to build." );
    expect(handed.replace(/\/a\/[A-Za-z0-9]+/g, '/a/<id>')).toBe(started.replace(/\/a\/[A-Za-z0-9]+/g, '/a/<id>'));
    expect(started.replace(/\/a\/[A-Za-z0-9]+/g, '/a/<id>')).toBe(existingPaste(BASE, '<id>'));
  });
});

/**
 * The BRIEF and the CONTRACT — the two surfaces the starter sends an agent to next. Four
 * single-thought files used to assert one paragraph of this each (`m3-publish-first`,
 * `brief-auth-rule`, `agent-contract`, `publishing-doc-tokens`); they are one rule about one pair
 * of functions, so they are one describe. Their byte caps went to skill-tree.test.ts's single
 * sweep, and their retired-vocabulary lines to case (c) above and to retired-surfaces.test.ts.
 */
describe('what the brief and the contract teach next', () => {

  it('teaches reuse before new publication and preserves identity during recovery', () => {
    const sheet = buildQuickSheet('https://example.test');
    expect(sheet.indexOf('For a supplied artifact')).toBeLessThan(sheet.indexOf('For a new artifact'));
    expect(sheet).toContain('Preserve exactly the identity fields returned');
    expect(sheet).toContain('never add `version` when absent');
    expect(sheet).toContain('after an uncertain write repeat the same command and arguments');
    expect(sheet).toContain('references/markup.md');
    expect(sheet).toContain('references/design.md');
  });


});


/**
 * The brief (`skills/artifactbin/SKILL.md`) is the ONE file a harness reads on its own: its description is
 * always in context, its body loads on trigger, and the references load only when the body sends the agent
 * there. So the description must be the trigger, the body must carry the example verbatim, and both must fit
 * the caps. The same folder holds `llms.txt`, whose first line is the blurb the discovery meta tag repeats.
 * The single npm setup line on every surface is case (b) above.
 */
describe('the brief', () => {
  const brief = skillTree().get('artifactbin/SKILL.md')!;
  const sheet = buildQuickSheet(BASE);

  it('its description is the trigger: links, the CLI and the tasks, within the harness cap', () => {
    expect(brief.description.length).toBeLessThanOrEqual(1024);
    for (const trigger of ['artifactbin.dev', 'HTTP', 'publish', 'edit', 'comment', 'query', 'export', 'dashboard', 'deck', 'dataset']) {
      expect(brief.description).toContain(trigger);
    }
    expect(brief.description).toContain('Use for artifactbin.dev');
  });

  it('teaches the task, connection, authoring and verification steps before the example and reference tree', () => {
    const at = (s: string) => { const i = sheet.indexOf(s); expect(i, s).toBeGreaterThanOrEqual(0); return i; };
    const order = ['## 0. Understand user need','## 1. Get connected','## 2. Understand create and edit','afbin pull','## 3. Shape the content','## 4. Save, share and verify','## Example','```jsx','## Reference tree'].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('inlines example.jsx verbatim inside its jsx fence and stays under the always-read cap', () => {
    const example = skillExample();
    expect(example).toMatch(/^---\n/);
    expect(sheet).toContain('```jsx\n' + example.trimEnd() + '\n```');
    expect(sheet).not.toContain('[[');
  });

  it('the example teaches the rules the prose no longer repeats', () => {
    const example = skillExample();
    for (const rule of ['static JSX', 'className', 'custom CSS lives here', '<Helmet>', '<Import name="sales"', 'sales.rows', 'ref:<id>', '$region', '"$monthly"', 'persistent id', 'never hand-rolled <svg>', '@2xl:', 'edit_id', 'visibility']) {
      expect(example, rule).toContain(rule);
    }
  });
});

describe('llms.txt and the discovery head', () => {
  it('the shared root and deployment-scoped discovery teach both CLI and HTTP', () => {
    const text = llmsText(BASE);
    expect(text).toMatch(/^## Read first/);
    expect(agentBlurb()).toContain('artifactbin');
    const help = agentDiscovery(BASE);
    expect(help.url).toBe(`${BASE}/llms.txt`);
    expect(help.instruction).toContain(`${BASE}/skills/artifactbin.zip`);
    expect(help.instruction).toContain('HTTP API');
    // Product blurb and shared root are separate; discovery need not repeat the blurb.
    expect(help.instruction).not.toContain(agentBlurb());
  });

  it('the guide teaches npm CLI and email HTTP without retired installation or token doors', () => {
    const text = llmsText(BASE);
    for (const line of ['/skills/artifactbin.zip', 'POST /api/artifacts', 'expectedVersion', `${BASE}/llms/html-authoring`, 'skill']) expect(text,line).toContain(line);
    expect(text).not.toContain('[[');
    const guide = JSON.stringify(gettingStarted(BASE));
    expect(guide).toContain('artifactbin skill');
    expect(guide).not.toMatch(/@afbin\/cli|install\.sh/);
    expect(llmsText(`${BASE}/`)).toBe(text);
  });

  it('the head titles the help link for afbin and carries the afbin meta on the caller base', () => {
    expect(AGENT_HELP_TITLE).toBe('Agent guide: authentication, creation, editing, and operations');
    const head = agentDiscoveryHead(agentDiscovery('https://x.test/'));
    expect(head).toContain(`<link rel="help" href="https://x.test/llms.txt" title="${AGENT_HELP_TITLE}">`);
    expect(head).toContain('name="agents"');
    expect(head).not.toContain('name="cli"');
  });
});

describe('public HTTP authoring references', () => {
  it('renders the existing reference sources with working public links and no template markers', () => {
    for (const file of skillTree().files.filter(file => file.ref && file.dir === 'artifactbin' && isPublicSkillTopic(file.file.replace(/\.md$/,'')))) {
      const topic = file.file.replace(/\.md$/, '');
      const actual = publicGuideText(topic, BASE);
      const expected = projectSkillLinks(file,renderSkill(file,{base:BASE,transport:'http'}),BASE);
      expect(actual, topic).toBe(expected);
      expect(actual, topic).not.toMatch(/\[\[|{%/);
      for (const [, linkedTopic] of actual!.matchAll(/\]\(http:\/\/localhost:3000\/llms\/([a-z0-9-]+)/g)) {
        expect(publicGuideText(linkedTopic!, BASE), `${topic} -> ${linkedTopic}`).not.toBeNull();
      }
    }
  });

  it('serves a public guide, substitutes the origin and refuses unknown or unsafe topics', async () => {
    const response = await guideRoute(new Request(BASE + '/llms/html-authoring'), {params:Promise.resolve({topic:'html-authoring'})});
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(MARKDOWN_CONTENT_TYPE);
    expect(publicGuideText('html-authoring', BASE + '/')).toBe(publicGuideText('html-authoring', BASE));
    expect(await response.text()).toBe(publicGuideText('html-authoring', BASE));
    for (const topic of ['not-a-guide','../markup','Markup','markup.md','%2e%2e','../SKILL','']) {
      expect(publicGuideText(topic, BASE), topic).toBeNull();
      expect((await guideRoute(new Request(BASE + '/llms/unknown'), {params:Promise.resolve({topic})})).status, topic).toBe(404);
    }
  });

  it('teaches canonical HTML replacement with conditional identity and bounded guide size',()=>{
    const text=publicGuideText('html-authoring',BASE)!;
    for(const value of ['html','expectedVersion','expectedState','Idempotency-Key'])expect(text).toContain(value);
    expect(text).not.toContain('/prepare');
    expect(Buffer.byteLength(text)).toBeLessThan(8192);
  });
});


it('the published HTTP comment example creates, replies, resolves, reopens and edits through real handlers', async () => {
  const guide = legacyGuideText('http-api',BASE)!;
  const script = guide.match(/\/\/ BEGIN HTTP COMMENTS\n([\s\S]*?)\/\/ END HTTP COMMENTS/)?.[1];
  expect(script, 'executable HTTP comment contract is published').toBeTruthy();
  const user = await createUser({email:'http-comments-contract@example.com'});
  const token = await mintToken('http-contract', user.id, undefined, {expiresInMs:null});
  const artifact = await createArtifact('', user.id, {format:'markup', source:'<p id="message">Alpha</p>', content:'<p id="message">Alpha</p>', meta:{}} as never);
  const localFetch = async (url:string, init?:RequestInit) => {
    const path = new URL(url).pathname;
    const annId = path.split('/')[5];
    const req = request(path, {method:init?.method ?? 'GET', token:token.token, ...(init?.body ? {body:init.body, headers:{'Content-Type':'application/json'}} : {})});
    const params = {params:Promise.resolve({id:artifact.id, ...(annId ? {annId} : {})})};
    return annId ? (init?.method === 'PATCH' ? editCommentRoute(req, params) : actOnCommentRoute(req, params)) : init?.method === 'POST' ? createCommentRoute(req, params) : listCommentsRoute(req, params);
  };
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const result = await new AsyncFunction('fetch','base','accessToken','artifactId','nodeId',script + '\nreturn {created,replied,resolved,reopened,edited};')(localFetch, BASE, token.token, artifact.id, 'message');
  expect(result.created.thread).toHaveLength(1);
  expect(result.replied.thread).toHaveLength(2);
  expect(result.resolved.status).toBe('resolved');
  expect(result.reopened.status).toBe('open');
  expect(result.reopened.revision).toBeGreaterThan(result.created.revision);
  expect(result.edited.thread[0]).toMatchObject({body:'Please clarify this paragraph', edited_at:expect.any(String)});
  expect(result.edited.revision).toBe(result.reopened.revision + 1);
  // A plain reply only appends and never conflicts; the revision guard is on state changes.
  const stale = await actOnCommentRoute(request(`/api/artifacts/${artifact.id}/annotations/${result.created.id}`, {method:'POST',token:token.token,json:{resolve:true,expected_revision:result.created.revision}}), {params:Promise.resolve({id:artifact.id,annId:result.created.id})});
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({error:'annotation_conflict',current_revision:result.edited.revision});
});


it('the published browser example preserves a capacity refusal and only polls and closes accepted sessions', async () => {
  const script = legacyGuideText('http-api', BASE)!.match(/## Browser preview and interactive QA[\s\S]*?```js\n([\s\S]*?)```/)?.[1];
  expect(script).toBeTruthy();
  const sessions = createBrowserSessions(async () => ({run: async () => ({result:'screenshot',pages:[],attachments:[]}), close:async () => {}}));
  const other: Actor = {credential:'bearer', userId:'another-owner'};
  const actor: Actor = {credential:'bearer', userId:'example-owner'};
  const operations: string[] = [];
  const localFetch = async (_url: string, init: RequestInit) => {
    const body=JSON.parse(String(init.body));operations.push(body.op);
    return Response.json(await sessions.request({...body,actor} as BrowserSessionRequest));
  };
  const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
  const run=()=>new AsyncFunction('fetch','base','accessToken','artifactId',script)(localFetch,BASE,'test-token','ab3cd9');
  try {
    for(const session_id of ['occupied-one','occupied-two'])await sessions.request({actor:other,op:'script',session_id,execution_id:'occupied',create:true,code:''});
    await expect(run()).rejects.toThrow(/SESSION_CAPACITY.*None of them are yours/);
    expect(operations).toEqual(['script']);
    await sessions.request({actor:other,op:'close',session_id:'occupied-one'});
    operations.length=0;
    await expect(run()).resolves.toBeUndefined();
    expect(operations[0]).toBe('script');expect(operations.at(-1)).toBe('close');
  } finally {await sessions.close();}
});

it('HTTP guidance preserves rotating credentials across tasks and renews without email login',()=>{
 const guide=publicGuideText('http-auth',BASE)!;
 expect(guide).toContain('refresh_token');expect(guide).toContain('client_id');
 expect(guide).toContain('persistent secret store');expect(guide).toContain('0600');
 expect(guide).toContain('grant_type');expect(guide).toContain('/oauth/token');
 expect(guide).toContain('Atomically');expect(guide).not.toContain('there is no refresh token');
});


describe('shared instructions after missing credentials and before publishing claims',()=>{
 it('asks for the real recipient email before sending an OTP rather than inventing an identity',()=>{
  const guide=publicGuideText('http-auth',BASE)!;
  expect(guide).toContain('otherwise ask the user for their email');
  expect(guide.indexOf('otherwise ask the user for their email')).toBeLessThan(guide.indexOf('POST /api/auth/email-otp/send-verification-otp'));
  expect(guide).toContain('Do not invent an email');
  expect(guide).toContain('No product installation is needed.');
 });
 it('teaches the supported local CLI status read without promising live authentication',()=>{
  const brief=buildQuickSheet(BASE);
  expect(brief).toContain('`afbin status`');
  expect(brief).toContain('last observed, no login');
  expect(brief).toContain('`afbin auth status` is not a status command');
 });
 it('keeps hosted root guidance within budget at production and custom origins',()=>{
  for(const origin of ['https://app.artifactbin.dev','https://artifacts.acme.example']) {
   const text=llmsText(origin);
   console.info('Hosted root bytes',origin,Buffer.byteLength(text));
   expect(Buffer.byteLength(text),origin).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
  }
 });
 it('grounds numerical claims and comparisons in query results and labels assumptions',()=>{
  const brief=buildQuickSheet(BASE);
  expect(brief).toContain('Check numerical claims against query results');
  expect(brief).toContain('every named series');
  expect(brief).toContain('Label assumptions');
 });
});

it('keeps live comment tracking from blocking existing work or waiting for process termination', () => {
 const hint = monitoringGuidance(DEFAULT_SERVER, 'abc123', 'markup') as {monitoring:{instruction:string}};
 expect(hint.monitoring.instruction).toContain('background');
 expect(hint.monitoring.instruction).toContain('existing comments');
 const guide = legacyGuideText('monitoring', DEFAULT_SERVER)!;
 expect(guide).toContain('Do not wait for the watch process to exit');
 expect(guide).toContain('head');
 expect(guide).toContain('wait=0');
 expect(guide).toContain('Save the returned cursor');
});

/**
 * A WATCH NOTHING READS ANSWERS NOTHING. In the preview-then-monitor eval every run that started the watch with a tool
 * that wakes the agent per output line answered the comment; every run that started it as a plain background job did
 * not. Every surface that tells an agent to watch says so in harness-neutral words, with the bounded fallback.
 */
it('teaches every surface to watch with a tool that wakes the agent, never a plain background job, and to poll without one', () => {
 const {instruction} = (monitoringGuidance(DEFAULT_SERVER, 'abc123', 'markup') as {monitoring:{instruction:string}}).monitoring;
 const section = (text:string) => text.split('\n### Monitoring\n')[1]!.split('\n## ')[0]!;
 const skill = skillTree().get('artifactbin/SKILL.md')!;
 const surfaces = {
  instruction,
  cliSkill: section(renderSkill(skill, {base: DEFAULT_SERVER, transport: 'cli'})),
  guide: legacyGuideText('monitoring', DEFAULT_SERVER)!.split('\n## CLI')[0]!,
 };
 for (const [name, text] of Object.entries(surfaces)) {
  expect(text, name).toContain('After the first successful save or local preview');
  expect(text, name).toContain('do not ask first');
  expect(text, name).toContain('until the session ends or the user says stop');
  expect(text, name).not.toContain('only when requested');
  expect(text, name).toMatch(/wakes you on each (?:output line|new comment)/);
  expect(text, name).toContain('plain background job');
  expect(text, name).toContain('between work steps');
 }
 expect(surfaces.cliSkill).toContain('`afbin comment <url|file> --json`');
 // Replying is never publishing: an agent asked to keep a page local answered by editing alone and never replied.
 expect(surfaces.cliSkill).toContain('push it if the page is published');
 expect(surfaces.cliSkill).toContain('a reply on a local file stays local');
});

it('reuses an executable HTTP dataset creation example in both guides', async () => {
 const guides=['http-api','publishing-datasets'].map(topic=>legacyGuideText(topic,BASE));
 const bodies=guides.map(guide=>{
  const section=guide.split('## HTTP dataset creation')[1];
  expect(section).toBeDefined();
  expect(section).toContain('POST /api/artifacts');
  const example=section!.match(/```json\n([\s\S]*?)\n```/)?.[1];
  expect(example).toBeDefined();return JSON.parse(example!);
 });
 expect(bodies[0]).toEqual(bodies[1]);
 const user=await createUser({email:'mxmx_test_dataset_guide@example.test'});
 const token=await mintToken('dataset-guide',user.id,undefined,{expiresInMs:null});
 const response=await createArtifactRoute(request('/api/artifacts',{method:'POST',token:token.token,json:bodies[0]}));
 expect(response.status).toBe(201);
 const result=await response.json();expect(result.id).toBeTruthy();expect(result.url).toContain('/a/');
});

it('HTTP authentication is direct and reuses the existing rotating credential store',()=>{
 const guide=publicGuideText('http-auth',BASE)!;
 expect(llmsText(BASE)).toContain(`${BASE}/llms/http-auth`);
 for(const text of [guide]){
  expect(text).not.toContain('credentials.mjs');
  for(const path of ['/api/auth/email-otp/send-verification-otp','/api/auth/sign-in/email-otp','/api/authentication/token','/oauth/token'])expect(text).toContain(`POST ${path}`);
  expect(text).toContain('Authorization: Bearer <access_token>');
  expect(text).toContain('across sessions');
 }
 for(const field of ['ARTIFACTBIN_URL','ARTIFACTBIN_TOKEN','ARTIFACTBIN_REFRESH_TOKEN','ARTIFACTBIN_CLIENT_ID','ARTIFACTBIN_EXPIRES_AT'])expect(guide).toContain(field);
 for(const part of ['ARTIFACTBIN_HOME','credentials.env','alias','serialized','grant_type','invalid_grant'])expect(guide).toContain(part);
});

it('keeps sign-in conditional across root guides and discovery', () => {
 expect(llmsText(BASE)).not.toContain('Install CLI only when requested');
 for (const text of [buildQuickSheet(BASE)]) {
  expect(text).toContain('Missing credentials do not mean a new');
  expect(text).not.toContain('Install CLI only when requested');
  expect(text).toContain('If sign-in is required');
  expect(text).toContain('email already provided');
 }
 expect(agentDiscovery(BASE).instruction).toContain('If sign-in is required');
});

it('lists every shipped reference in the main reference tree', () => {
 const tree=buildQuickSheet(BASE).split('## Reference tree')[1]!;
 for (const file of skillTree().files.filter(file=>file.ref && file.audience==='agent'&&!file.file.startsWith('html-'))) {
  expect(tree,file.path).toContain(`](references/${file.file})`);
 }
});
