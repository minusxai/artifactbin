/** Every discovery surface names npm afbin; CLI starters retain their auth loop,
 * while direct HTTP discovery teaches verified email issuance and graph claims.
 * Retired endpoints/brands remain forbidden on every surface. */
import { describe, expect, it } from 'vitest';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { agentContract } from '@/lib/serving';
import { existingPaste } from '@/lib/serving';
import { gettingStartedMarkdown } from '@/lib/serving/getting-started';
import { publicGuideText, llmsText } from '@/lib/serving/agent-references.server';
import { GET as guideRoute } from '@/app/llms/[topic]/route';
import { renderSkill } from '@/lib/skills/render';
import { agentDiscovery } from '@/lib/compiled-page/agent-discovery';
import { createArtifact } from '@/lib/artifacts';
import { MARKDOWN_CONTENT_TYPE, unauthorized } from '@/lib/http';
import {projectSkillLinks} from '@/lib/skills/serve';
import { renderTree, skillTree } from '@/lib/skills';
import { buildQuickSheet } from '@/test/helpers/skill-docs';
import { createUser, mintToken } from '@/lib/accounts';
import { POST as createCommentRoute, GET as listCommentsRoute } from '@/app/api/artifacts/[id]/annotations/route';
import { POST as actOnCommentRoute } from '@/app/api/artifacts/[id]/annotations/[annId]/route';
import { createBrowserSessions } from '../../../browser/src/sessions';
import type { Actor, BrowserSessionRequest } from '@artifactbin/contracts';
import { request, useAppHarness } from '@/__tests__/harness';

useAppHarness();

const BASE = 'http://localhost:3000';
const INSTALLER = `npx --yes @afbin/cli@latest setup`;
/** The canonical bootstrap sentence: the one place the npm spelling appears in a document. */
const BOOTSTRAP = 'npx --yes @afbin/cli@latest setup';

/** The retired vocabulary. Each of these, in an agent's hands, is a wrong turn. */
const RETIRED = ['paste', 'tokens/new', 'tokens/anonymous', 'MCP', '/raw', '/docs/'];
const CLI_ONLY_RETIRED = ['token','mint','claim'];
const httpDiscovery=(name:string)=>name==='the 401 hint'||name==='skills/artifactbin/llms.txt'||name==='skills/artifactbin/SKILL.md'||name==='lib/compiled-page/agent-discovery meta';
const linkedInstaller = (name: string) => name==='skills/artifactbin/SKILL.md'||name==='skills/artifactbin/llms.txt'|| name === 'lib/agent-copy existingPaste' || name.endsWith(' prompt') ;

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
    ['skills/artifactbin/SKILL.md', buildQuickSheet(BASE)],
    ['skills/artifactbin/llms.txt', llmsText(BASE)],
    ['GET /getting-started.md', gettingStartedMarkdown(BASE)],
    ['lib/compiled-page/agent-discovery meta', agentDiscovery(BASE).instruction],
    ['lib/agent-contract', agentContract(BASE)],
    ['the 401 hint', refused.help],
  ];
};

/** (c) is applied to the text with the ONE sanctioned sentence removed — once, exactly. */
const withoutTheException = (text: string): string => text.replace(ALLOWED_SENTENCE, '');

describe('every agent-facing starter says the same thing', () => {
  it('(a) names afbin', async () => {
    for (const [name, text] of await surfaces()) expect(text, name).toContain('afbin');
  });

  it('(b) links HTTP auth on refusal and offers CLI setup on the relevant surfaces', async () => {
    for (const [name, text] of await surfaces()) expect(text, name).toContain(name==='the 401 hint' ? `${BASE}/llms/http-auth` : linkedInstaller(name) ? `${BASE}/getting-started.md` : INSTALLER);
    expect(gettingStartedMarkdown(BASE)).toContain(INSTALLER);
  });

  it('(b) spells npm only as that one setup line; every other command is `afbin <command>`', async () => {
    for (const [name, text] of await surfaces()) {
      expect(text.split('npx --yes @afbin/cli@').length - 1, name).toBe(linkedInstaller(name)||name==='the 401 hint' ? 0 : 1);
      for (const [, command] of text.matchAll(/@afbin\/cli@\S+ ([a-z-]+)/g)) expect(command, name).toBe('setup');
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
    expect(llmsText(BASE)).toContain(`${BASE}/llms/http-authoring`);
    expect(llmsText(BASE)).toContain(`${BASE}/llms/http-document-graph`);
  });

  it('CLI and HTTP teach the same reply and mobile authoring rules without sharing CLI authentication', () => {
    const rules = [
      'URL-only requests get the URL alone.',
      'At 390px, fix overflow, clipping and unreachable controls. Use numeric roles for figures, text roles for prose; stack crowded stats.',
    ];
    const brief = buildQuickSheet(BASE);
    const httpAuthoring = publicGuideText('http-authoring', BASE)!;
    const discovery = llmsText(BASE);
    for (const text of [httpAuthoring, discovery, brief]) {
      for (const rule of rules) expect(text).toContain(rule);
    }
    for (const text of [httpAuthoring, discovery]) {
      expect(text).not.toContain('Automatic browser approval also applies');
      expect(text).not.toContain('~/.artifactbin/hosts/<origin-id>/credentials.env');
    }
    expect(discovery).toContain(`${BASE}/llms/http-api`);
  });

  it('the ONE exception is the skill\'s prohibition, spelled exactly and only once', () => {
    const skill = buildQuickSheet(BASE);
    expect(skill.split(ALLOWED_SENTENCE)).toHaveLength(2);
    // And it is a prohibition, not an offer: nothing around it tells an agent where to get one.
    expect(withoutTheException(skill).toLowerCase()).not.toContain('token');
  });

  it('the starter includes the editable brief and is identical everywhere it is handed over', async () => {
    const all = await surfaces();
    const [, started] = all.find(([name]) => name === 'POST /api/start prompt')!;
    const [, handed] = all.find(([name]) => name.includes('agent-prompt'))!;
    expect(started).toContain("\n\n---\n\nLet's build an artifact for " );
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
  const brief = renderTree(skillTree(), 'https://artifactbin.dev').find(({ file }) => file.path === 'artifactbin/SKILL.md')!.text;

  it('links optional CLI setup while teaching automatic sign-in and shared credential reuse', () => {
    expect(brief).not.toContain(BOOTSTRAP);
    expect(brief).toContain('npx downloads the CLI');
    expect(brief).not.toContain('shorthand');
    expect(brief).toContain('references/npm-local.md');
    expect(brief).toMatch(/automatic|authenticates itself|signs you in/i);
    expect(brief).toContain('origin-scoped credentials');
    expect(brief).toContain('browser approval');
    expect(brief).toMatch(/never.*mint/i);
  });

  it('teaches reuse before new publication and preserves identity during recovery', () => {
    const sheet = buildQuickSheet('https://example.test');
    expect(sheet.indexOf('For a supplied artifact')).toBeLessThan(sheet.indexOf('For a new artifact'));
    expect(sheet).toContain('Preserve exactly the identity fields returned');
    expect(sheet).toContain('never add `version` when absent');
    expect(sheet).toContain('after an uncertain write repeat the same command and arguments');
    expect(sheet).toContain('references/markup.md');
    expect(sheet).toContain('references/design.md');
  });

  it('spells local help, origin-scoped browser setup and the current private config directory', () => {
    const contract = agentContract('https://example.test');
    expect(contract).toContain('`afbin auth --server https://example.test`');
    expect(contract).toContain(BOOTSTRAP);
    expect(contract).toContain('`afbin help`');
    expect(contract).toContain('~/.artifactbin/hosts/<origin-id>/credentials.env');
    expect(contract).toContain('--yes --json');
    expect(contract).toContain('browser approval');
  });
});


describe('public HTTP authoring references', () => {
  it('renders the existing reference sources with working public links and no template markers', () => {
    for (const file of skillTree().files.filter(file => file.ref && file.dir === 'artifactbin')) {
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
    const response = await guideRoute(new Request(BASE + '/llms/http-authoring'), {params:Promise.resolve({topic:'http-authoring'})});
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(MARKDOWN_CONTENT_TYPE);
    expect(publicGuideText('http-api', BASE + '/')).toBe(publicGuideText('http-api', BASE));
    expect(await response.text()).toBe(publicGuideText('http-authoring', BASE));
    for (const topic of ['not-a-guide','../markup','Markup','markup.md','%2e%2e','../SKILL','']) {
      expect(publicGuideText(topic, BASE), topic).toBeNull();
      expect((await guideRoute(new Request(BASE + '/llms/unknown'), {params:Promise.resolve({topic})})).status, topic).toBe(404);
    }
  });

  it('teaches source preparation before graph construction and links the format without an install', () => {
    const text = publicGuideText('http-authoring',BASE)!;
    expect(text.indexOf('## Prepare an edit from JSX')).toBeLessThan(text.indexOf('// BEGIN HTTP TEXT EDIT'));
    for (const topic of ['markup','markup-data','design-systems','templates']) expect(text).toContain(`${BASE}/llms/${topic}`);
    expect(text).toContain('No CLI, bundled code or manual graph construction is needed.');
  });

  it('teaches the HTTP workflow without duplicating its QA client and fits the production guide budget', () => {
    const text = publicGuideText('http-authoring', 'https://app.artifactbin.dev')!;
    expect(text).toContain('Use each link target as served; `.md` appears in source labels, while public guide URLs are extensionless.');
    expect(text).toContain('Batch independent reads and edits; reserve time for one final response.');
    expect(text).toContain('After required checks pass, do not repeat unchanged QA.');
    expect(text).toContain('For DOM probes, use `page.evaluate`.');
    expect(text).toContain('[copyable HTTP browser QA example](https://app.artifactbin.dev/llms/http-api#browser-preview-and-interactive-qa)');
    expect(text).not.toContain('const session_id=crypto.randomUUID()');
    expect(Buffer.byteLength(text)).toBeLessThan(8192);
  });
});


it('the published HTTP comment example creates, replies, resolves and reopens through real handlers', async () => {
  const guide = publicGuideText('http-api',BASE)!;
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
    return annId ? actOnCommentRoute(req, params) : init?.method === 'POST' ? createCommentRoute(req, params) : listCommentsRoute(req, params);
  };
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const result = await new AsyncFunction('fetch','base','accessToken','artifactId','nodeId',script + '\nreturn {created,replied,resolved,reopened};')(localFetch, BASE, token.token, artifact.id, 'message');
  expect(result.created.thread).toHaveLength(1);
  expect(result.replied.thread).toHaveLength(2);
  expect(result.resolved.status).toBe('resolved');
  expect(result.reopened.status).toBe('open');
  expect(result.reopened.revision).toBeGreaterThan(result.created.revision);
  const stale = await actOnCommentRoute(request(`/api/artifacts/${artifact.id}/annotations/${result.created.id}`, {method:'POST',token:token.token,json:{reply:'stale duplicate',expected_revision:result.created.revision}}), {params:Promise.resolve({id:artifact.id,annId:result.created.id})});
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({error:'annotation_conflict',current_revision:result.reopened.revision});
});


it('the published browser example preserves a capacity refusal and only polls and closes accepted sessions', async () => {
  const script = publicGuideText('http-api', BASE)!.match(/## Browser preview and interactive QA[\s\S]*?```js\n([\s\S]*?)```/)?.[1];
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
