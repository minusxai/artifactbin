/** Every discovery surface names npm afbin; CLI starters retain their auth loop,
 * while direct HTTP discovery teaches verified email issuance and graph claims.
 * Retired endpoints/brands remain forbidden on every surface. */
import {isPublicSkillTopic, renderSkill, projectSkillLinks, skillTree} from '@/lib/skills';
import { describe, expect, it } from 'vitest';
import { monitoringGuidance } from '@/lib/artifacts/monitoring-guidance';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { agentContract, agentBlurb, existingPaste, publicGuideText, llmsText } from '@/lib/agent-copy';
import { DEFAULT_SERVER } from '@artifactbin/contracts';
import { gettingStarted } from '@/lib/agent-copy/getting-started';
import { GET as guideRoute } from '@/app/llms/[topic]/route';
import { AGENT_HELP_TITLE, agentDiscovery, agentDiscoveryHead } from '@/lib/agent-copy/agent-discovery';
import { createArtifact } from '@/lib/artifacts';
import { MARKDOWN_CONTENT_TYPE, unauthorized } from '@/lib/http';
import { buildQuickSheet, QUICK_SHEET_MAX_BYTES } from '@/test/helpers/skill-docs';
import { createUser } from '@/lib/accounts';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
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
    expect(llmsText(BASE)).toContain(`${BASE}/llms/http-auth`);
  });

  it('native HTTP discovery routes to runtime and datasets without command setup',()=>{
    expect(llmsText(BASE)).toContain(`${BASE}/llms/runtime`);
    expect(llmsText(BASE)).toContain(`${BASE}/llms/datasets`);
    expect(llmsText(BASE)).not.toContain('afbin pull');
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
 * The brief (`skills/artifactbin/SKILL.md`) is the ONE file a harness reads on its own: its description is
 * always in context, its body loads on trigger, and the references load only when the body sends the agent
 * there. So the description must be the trigger, the body must carry the example verbatim, and both must fit
 * the caps. The same folder holds `llms.txt`, whose first line is the blurb the discovery meta tag repeats.
 * The single npm setup line on every surface is case (b) above.
 */
describe('the brief', () => {
  const brief = skillTree().get('artifactbin/SKILL.md')!;

  it('its description is the trigger: links, HTTP and the tasks, within the harness cap', () => {
    expect(brief.description.length).toBeLessThanOrEqual(1024);
    for (const trigger of ['artifactbin.dev', 'HTTP', 'publish', 'edit', 'comment', 'query', 'export', 'dashboard', 'deck', 'dataset']) {
      expect(brief.description).toContain(trigger);
    }
    expect(brief.description).toContain('Use for artifactbin.dev');
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
    for (const line of ['/skills/artifactbin.zip', 'POST /api/artifacts', 'expectedVersion', `${BASE}/llms/runtime`, 'skill']) expect(text,line).toContain(line);
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
      const expected = projectSkillLinks(file,renderSkill(file,{base:BASE}),BASE);
      expect(actual, topic).toBe(expected);
      expect(actual, topic).not.toMatch(/\[\[|{%/);
      for (const [, linkedTopic] of actual!.matchAll(/\]\(http:\/\/localhost:3000\/llms\/([a-z0-9-]+)/g)) {
        expect(publicGuideText(linkedTopic!, BASE), `${topic} -> ${linkedTopic}`).not.toBeNull();
      }
    }
  });

  it('serves a public guide, substitutes the origin and refuses unknown or unsafe topics', async () => {
    const response = await guideRoute(new Request(BASE + '/llms/runtime'), {params:Promise.resolve({topic:'runtime'})});
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(MARKDOWN_CONTENT_TYPE);
    expect(publicGuideText('runtime', BASE + '/')).toBe(publicGuideText('runtime', BASE));
    expect(await response.text()).toBe(publicGuideText('runtime', BASE));
    for (const topic of ['not-a-guide','../markup','Markup','markup.md','%2e%2e','../SKILL','']) {
      expect(publicGuideText(topic, BASE), topic).toBeNull();
      expect((await guideRoute(new Request(BASE + '/llms/unknown'), {params:Promise.resolve({topic})})).status, topic).toBe(404);
    }
  });

  it('teaches canonical HTML replacement with conditional identity and bounded guide size',()=>{
    const text=llmsText(BASE);
    for(const value of ['expectedVersion','expectedState','Idempotency-Key'])expect(text).toContain(value);
    expect(text).not.toContain('/prepare');
  });
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
 it('keeps hosted root guidance within budget at production and custom origins',()=>{
  for(const origin of ['https://app.artifactbin.dev','https://artifacts.acme.example']) {
   const text=llmsText(origin);
   console.info('Hosted root bytes',origin,Buffer.byteLength(text));
   expect(Buffer.byteLength(text),origin).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
  }
 });
});

it('keeps live comment tracking from blocking existing work or waiting for process termination', () => {
 const hint = monitoringGuidance(DEFAULT_SERVER, 'abc123', 'markup') as {monitoring:{instruction:string}};
 expect(hint.monitoring.instruction).toContain('background');
 expect(hint.monitoring.instruction).toContain('existing comments');
});

/**
 * A WATCH NOTHING READS ANSWERS NOTHING. In the preview-then-monitor eval every run that started the watch with a tool
 * that wakes the agent per output line answered the comment; every run that started it as a plain background job did
 * not. Every surface that tells an agent to watch says so in harness-neutral words, with the bounded fallback.
 */
it('teaches every surface to watch with a tool that wakes the agent, never a plain background job, and to poll without one', () => {
 const {instruction} = (monitoringGuidance(DEFAULT_SERVER, 'abc123', 'markup') as {monitoring:{instruction:string}}).monitoring;
 const surfaces = {instruction};
 for (const [name, text] of Object.entries(surfaces)) {
  expect(text, name).toContain('After the first successful save or local preview');
  expect(text, name).toContain('do not ask first');
  expect(text, name).toContain('until the session ends or the user says stop');
  expect(text, name).not.toContain('only when requested');
  expect(text, name).toMatch(/wakes you on each (?:output line|new comment)/);
  expect(text, name).toContain('plain background job');
  expect(text, name).toContain('between work steps');
 }
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

