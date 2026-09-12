import {expect,it} from 'vitest';
import {buildPrompt} from '../lib/tasks';
import {TaskSchema} from '../lib/contracts';
import {existingPaste} from '../../services/app/lib/agent-copy';
const task=TaskSchema.parse({id:'publish',brief:'Publish a report.',checks:['published']});
const ACCESS={id:'abc123',base:'https://example.test'} as const;

it('starter IS the product’s own handover text — one source, so the eval cannot measure a line the product does not ship',()=>{
 const prompt=buildPrompt(task,ACCESS,{promptLevel:'starter'});
 expect(prompt).toContain(existingPaste(ACCESS.base,ACCESS.id));
 expect(prompt).toContain(task.brief);
});

it('starter teaches the afbin CLI and the installer without handing over a credential or fetching docs',()=>{
 const prompt=buildPrompt(task,ACCESS,{promptLevel:'starter'});
 expect(prompt).toContain('afbin');
 expect(prompt).toContain('curl -fsSL https://example.test/chat/install.sh | sh');
 expect(prompt).toContain('Run afbin help first');
 // The document arrives as a URL the agent can open — not a bare id, not a bare "server is" line.
 expect(prompt).toContain('https://example.test/a/abc123');
 expect(prompt).not.toContain('The artifactbin server is');
 expect(prompt).not.toMatch(/mx_[A-Za-z0-9_-]+|MCP|\/docs\/|\.env|afbin setup/);
});

it('starter is the default level, so an unstaged call and a {promptLevel:starter} call are one text',()=>{
 // `installed` vs `not-installed` is the CLI-staging (mode) axis and NOT an input to buildPrompt —
 // both flows receive exactly this starter text.
 expect(buildPrompt(task,ACCESS)).toBe(buildPrompt(task,ACCESS,{promptLevel:'starter'}));
 expect(buildPrompt(task,ACCESS,{vision:false})).toBe(buildPrompt(task,ACCESS,{promptLevel:'starter',vision:false}));
});

it('a cold-install publish task explicitly selects its task proxy before authentication',()=>{
 const prompt=buildPrompt(task,{id:'abc123',base:'http://127.0.0.1:45407'});
 expect(prompt).toContain('Pass --server http://127.0.0.1:45407 to every afbin server command');
 expect(prompt).not.toContain('https://artifactbin.dev');
});

it('hardcore gives only the brief and the bare base — no starter, no afbin, no artifact id, and it never throws',()=>{
 const prompt=buildPrompt(task,ACCESS,{promptLevel:'hardcore'});
 expect(prompt).toContain(task.brief);
 expect(prompt).toContain('Use https://example.test.');
 expect(prompt).not.toContain('afbin');
 expect(prompt).not.toContain('install.sh');
 expect(prompt).not.toContain('abc123');
 expect(prompt).not.toMatch(/mx_[A-Za-z0-9_-]+/);
 // Every task takes both levels: there is no access shape left that one of them cannot describe.
 expect(()=>buildPrompt({...task,seed:'<p>Seed</p>'},ACCESS,{promptLevel:'hardcore'})).not.toThrow();
});

it('tells text-only models to inspect markup, at both prompt levels',()=>{
 expect(buildPrompt(task,ACCESS,{vision:false})).toContain('cannot view images');
 expect(buildPrompt(task,ACCESS,{promptLevel:'hardcore',vision:false})).toContain('cannot view images');
});
