/** Every discovery surface names npm afbin; CLI starters retain their auth loop,
 * while direct HTTP discovery teaches verified email issuance and graph claims.
 * Retired endpoints/brands remain forbidden on every surface. */
import { describe, expect, it } from 'vitest';
import { POST as startRoute } from '@/app/api/start/route';
import { POST as agentPromptRoute } from '@/app/api/my/artifacts/[id]/agent-prompt/route';
import { agentContract } from '@/lib/serving';
import { agentBlurb, existingPaste } from '@/lib/serving';
import { DEFAULT_SERVER } from '@artifactbin/contracts';
import { afbinInstallCommand, afbinWindowsInstallCommand, gettingStarted, gettingStartedMarkdown } from '@/lib/serving/getting-started';
import { publicGuideText, llmsText } from '@/lib/serving/agent-references.server';
import { GET as guideRoute } from '@/app/llms/[topic]/route';
import { renderSkill } from '@/lib/skills/render';
import { AGENT_HELP_TITLE, agentDiscovery, agentDiscoveryHead } from '@/lib/compiled-page/agent-discovery';
import { createArtifact } from '@/lib/artifacts';
import { MARKDOWN_CONTENT_TYPE, unauthorized } from '@/lib/http';
import { renderTree, skillExample, skillTree } from '@/lib/skills';
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
const BOOTSTRAP = 'If `afbin` is not installed, run `npx --yes @afbin/cli@latest setup` once (Windows PowerShell: `npx.cmd --yes @afbin/cli@latest setup`); it installs the `afbin` command and the agent skills.';

/** The retired vocabulary. Each of these, in an agent's hands, is a wrong turn. */
const RETIRED = ['paste', 'tokens/new', 'tokens/anonymous', 'MCP', '/raw', '/docs/'];
const CLI_ONLY_RETIRED = ['token','mint','claim'];
const httpDiscovery=(name:string)=>name==='skills/artifactbin/llms.txt'||name==='lib/compiled-page/agent-discovery meta';
const linkedInstaller = (name: string) => name === 'lib/agent-copy existingPaste' || name.endsWith(' prompt') || name === 'skills/artifactbin/llms.txt';

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

  it('(b) carries the installer, so an agent without the binary is never stuck', async () => {
    for (const [name, text] of await surfaces()) expect(text, name).toContain(linkedInstaller(name) ? `${BASE}/getting-started.md` : INSTALLER);
    expect(gettingStartedMarkdown(BASE)).toContain(INSTALLER);
  });

  it('(b) spells npm only as that one setup line; every other command is `afbin <command>`', async () => {
    for (const [name, text] of await surfaces()) {
      expect(text.split('npx --yes @afbin/cli@').length - 1, name).toBe(linkedInstaller(name) ? 0 : 1);
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
    const guide=llmsText(BASE);
    expect(guide).toContain('Direct HTTP clients require email authentication');
    expect(guide).toContain('CLI and HTTP authentication require email');
    expect(guide).toContain('/api/authentication/token');
    expect(guide).toContain('Only verified email account sessions qualify');
    expect(guide).toContain('Authorization: Bearer <access_token>');
    expect(guide).toContain('patch.claims');
    expect(guide).toContain('expectedVersion:snapshot.version');
    expect(guide).toContain('document_update:prepared.document_update');
    expect(guide).toContain('](http://localhost:3000/llms/http-authoring)');
    expect(guide).toContain('](http://localhost:3000/llms/http-document-graph)');
    expect(guide).not.toMatch(/\]\(http-(?:api|authoring|document-graph)\.md\)/);
    expect(guide).not.toContain('{"csv":');
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
    expect(discovery).toContain('CLI and HTTP authentication require email');
    expect(discovery).toContain('Direct HTTP clients require email authentication');
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

  it('teaches automatic sign-in, browser approval, the private configuration location and the one-time setup line', () => {
    expect(brief).toContain(BOOTSTRAP);
    expect(brief.split('npx --yes @afbin/cli@').length - 1).toBe(1);
    expect(brief).not.toContain('shorthand');
    expect(brief).toContain('references/npm-local.md');
    expect(brief).toMatch(/automatic|authenticates itself|signs you in/i);
    expect(brief).toContain('~/.artifactbin/hosts/<origin-id>/credentials.env');
    expect(brief).toContain('browser approval');
    expect(brief).toContain('--yes');
    expect(brief).toMatch(/never.*mint/i);
  });

  it('teaches reuse before new publication and preserves identity during recovery', () => {
    const sheet = buildQuickSheet('https://example.test');
    expect(sheet.indexOf('For a supplied artifact')).toBeLessThan(sheet.indexOf('For a new artifact'));
    expect(sheet).toContain('Preserve its identity');
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


/**
 * The brief (`skills/artifactbin/SKILL.md`) is the ONE file a harness reads on its own: its description is
 * always in context, its body loads on trigger, and the references load only when the body sends the agent
 * there. So the description must be the trigger, the body must carry the example verbatim, and both must fit
 * the caps. The same folder holds `llms.txt`, whose first line is the blurb the discovery meta tag repeats.
 * The single npm setup line on every surface is case (b) above.
 */
describe('the brief, llms.txt and the discovery head (merged from skill-brief.test.ts)', () => {
  const PUBLIC = 'https://artifactbin.dev';
  const brief = skillTree().get('artifactbin/SKILL.md')!;
  const sheet = buildQuickSheet(PUBLIC);

  it('its description is the trigger: links, the CLI and the tasks, within the harness cap', () => {
    expect(brief.description.length).toBeLessThanOrEqual(1024);
    for (const trigger of ['artifactbin.dev', 'afbin', 'publish', 'edit', 'comment', 'query', 'export', 'dashboard', 'deck', 'dataset']) {
      expect(brief.description).toContain(trigger);
    }
    expect(brief.description).toMatch(/^Required for every artifactbin task/);
  });

  it('opens with what artifactbin and an artifact are, then the CLI loop, then the example, then the references', () => {
    const at = (s: string) => { const i = sheet.indexOf(s); expect(i, s).toBeGreaterThanOrEqual(0); return i; };
    const order = [at('Publish editable `.jsx`'), at('YAML metadata'), at('afbin pull'), at('## Example'), at('```jsx'), at('## Read next'), at('references/design.md')];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('inlines example.jsx verbatim inside its jsx fence', () => {
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

  it('llms.txt opens with the blurb, and the meta tag names npm afbin, Windows and email HTTP help, under 150 characters', () => {
    expect(llmsText(PUBLIC).split('\n')[0]).toBe(agentBlurb());
    const help = agentDiscovery(PUBLIC);
    expect(help.url).toBe(`${PUBLIC}/llms.txt`);
    expect(help.instruction).toBe('afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API.');
    expect(help.instruction.length).toBeLessThanOrEqual(150);
    // The blurb is still line 1 of the one-pager, still used elsewhere; the meta no longer repeats it.
    expect(help.instruction).not.toContain(agentBlurb());
  });

  it('llms.txt links the one setup guide and the CLI without a second installer, on any spelling of the base', () => {
    const text = llmsText(PUBLIC);
    for (const line of [`${PUBLIC}/getting-started.md`, `${PUBLIC}/getting-started`, 'afbin help', `${PUBLIC}/a/<id>`, `${PUBLIC}/@<user>/<id>-<slug>`, 'afbin preview report.jsx', 'afbin help http-api', 'skill']) {
      expect(text, line).toContain(line);
    }
    expect(text).not.toContain('[[');
    expect(text).not.toContain('@afbin/cli@');
    const guide = gettingStartedMarkdown(PUBLIC);
    expect(guide).toContain(afbinInstallCommand(PUBLIC));
    expect(guide).toContain(afbinWindowsInstallCommand(PUBLIC));
    expect(guide).toContain('artifactbin skill');
    // Case (b) pins the one npm line on the local base; the public base gets its own installer line.
    expect(guide.split('npx --yes @afbin/cli@').length - 1).toBe(1);
    for (const [, command] of guide.matchAll(/@afbin\/cli@\S+ ([a-z-]+)/g)) expect(command).toBe('setup');
    // `afbin setup`, /raw, MCP and /docs/ are retired-surfaces.test.ts's row for the one-pager.
    expect(llmsText(`${PUBLIC}/`)).toBe(text);
  });

  /** PUSH VALIDATES: the Getting started edit loop must not insert a redundant validate command before publishing. */
  it('its command line ends at push, because push validates — no separate validate step', () => {
    const edit = gettingStarted(DEFAULT_SERVER).sections.find(section => section.id === 'edit')!;
    expect(edit).toBeDefined();
    expect(edit.blocks.filter(block => block.kind === 'command').map(block => block.text)).toEqual([
      "afbin pull 'ARTIFACT_URL' --output artifact.jsx", 'afbin preview artifact.jsx', 'afbin push artifact.jsx',
    ]);
    expect(edit.blocks.map(block => block.text).join('\n')).toContain('Push validates the file before publishing.');
  });

  it('the head titles the help link for afbin and carries the afbin meta on the caller base', () => {
    expect(AGENT_HELP_TITLE).toBe('Agents: create, edit, or operate artifacts with the npm CLI or direct HTTP API');
    expect(agentDiscoveryHead(agentDiscovery('https://x.test/'))).toBe(`<link rel="help" href="https://x.test/llms.txt" title="${AGENT_HELP_TITLE}"><meta name="afbin" content="afbin: npx --yes @afbin/cli@latest setup; Windows: npx.cmd. HTTP: email auth; /llms.txt. Local/offline editing needs no remote API.">`);
  });

  it.each(['https://docs.example', 'http://127.0.0.1:5001/'])('npm setup selects self-hosted origins on Unix and Windows: %s', (base) => {
    const host = base.replace(/\/$/, '');
    expect(afbinInstallCommand(base)).toBe(`curl -fsSL '${host}/chat/install.sh' | sh`);
    expect(afbinWindowsInstallCommand(base)).toBe(`Invoke-RestMethod '${host}/chat/install.ps1' | Invoke-Expression`);
  });
  it.each([DEFAULT_SERVER, `${DEFAULT_SERVER}/`])('npm setup keeps the public command simple: %s', (base) => {
    expect(afbinInstallCommand(base)).toBe(`curl -fsSL '${DEFAULT_SERVER}/chat/install.sh' | sh`);
    expect(afbinWindowsInstallCommand(base)).toBe(`Invoke-RestMethod '${DEFAULT_SERVER}/chat/install.ps1' | Invoke-Expression`);
  });
});

describe('public HTTP authoring references', () => {
  it('renders the existing reference sources with working public links and no template markers', () => {
    for (const file of skillTree().files.filter(file => file.ref && file.dir === 'artifactbin')) {
      const topic = file.file.replace(/\.md$/, '');
      const actual = publicGuideText(topic, BASE);
      const expected = renderSkill(file, {base:BASE}).replace(/\]\((?:references\/)?([a-z0-9-]+)\.md(#[^)\s]+)?\)/g,
        (_match, name:string, hash:string|undefined) => `](${BASE}/llms/${['publishing','publishing-versions','publishing-datasets'].includes(name)?'http-api':name}${hash ?? ''})`);
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
    const text = llmsText(BASE);
    expect(text.indexOf('## Prepare an edit from JSX')).toBeLessThan(text.indexOf('## Document graph wire contract'));
    for (const topic of ['markup','markup-data','design-systems','templates']) expect(text).toContain(`${BASE}/llms/${topic}`);
    expect(text).toContain('An HTTP client does not need Node or the CLI');
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
  const guide = llmsText(BASE);
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
 const guide=publicGuideText('http-api',BASE)!;
 expect(guide).toContain('refresh_token');expect(guide).toContain('client_id');
 expect(guide).toContain('persistent secret store');expect(guide).toContain('0600');
 expect(guide).toContain('grant_type');expect(guide).toContain('/oauth/token');
 expect(guide).toContain('Atomically');expect(guide).not.toContain('there is no refresh token');
});
