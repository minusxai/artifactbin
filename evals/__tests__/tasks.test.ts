import {expect,it} from 'vitest';
import {buildPrompt} from '../lib/tasks';
import {TaskSchema} from '../lib/contracts';
const task=TaskSchema.parse({id:'publish',brief:'Publish a report.',handoff:'token',checks:['published']});
const TOKEN={kind:'token',id:'abc123',base:'https://example.test',token:'mx_secret'} as const;

it('starter teaches the afbin CLI and the installer without leaking the saved credential or fetching docs',()=>{
 const prompt=buildPrompt(task,TOKEN,{promptLevel:'starter'});
 expect(prompt).toContain(task.brief);
 expect(prompt).toContain('afbin');
 expect(prompt).toContain('curl -fsSL https://example.test/chat/install.sh | sh');
 expect(prompt).toContain('Run afbin help first');
 // The document arrives as a URL the agent can open — not a bare id, not a bare "server is" line.
 expect(prompt).toContain('https://example.test/a/abc123');
 expect(prompt).not.toContain('The artifactbin server is');
 expect(prompt).not.toMatch(/mx_secret|MCP|\/docs\/|\.env|afbin setup/);
});

it('starter is the default level, so an unstaged call and a {promptLevel:starter} call are one text',()=>{
 // `installed` vs `not-installed` is the CLI-staging (mode) axis and NOT an input to buildPrompt —
 // both flows receive exactly this starter text.
 expect(buildPrompt(task,TOKEN)).toBe(buildPrompt(task,TOKEN,{promptLevel:'starter'}));
 expect(buildPrompt(task,TOKEN,{vision:false})).toBe(buildPrompt(task,TOKEN,{promptLevel:'starter',vision:false}));
});

it('hardcore gives only the brief and the bare base — no starter, no afbin, no artifact id',()=>{
 const prompt=buildPrompt(task,TOKEN,{promptLevel:'hardcore'});
 expect(prompt).toContain(task.brief);
 expect(prompt).toContain('Use https://example.test.');
 expect(prompt).not.toContain('afbin');
 expect(prompt).not.toContain('install.sh');
 expect(prompt).not.toContain('abc123');
 expect(prompt).not.toContain('Run afbin help first');
 expect(prompt).not.toMatch(/mx_secret/);
});

it('starter for a task with no credential asks to publish, still teaching the CLI, inventing no token',()=>{
 const prompt=buildPrompt(task,{kind:'none',base:'https://example.test'},{promptLevel:'starter'});
 expect(prompt).toContain('publish to artifactbin at https://example.test');
 expect(prompt).toContain('afbin');
 expect(prompt).toContain('Run afbin help first');
 expect(prompt).not.toMatch(/mx_[A-Za-z0-9_-]+|\/docs\//);
});

it('tells text-only models to inspect markup, at both prompt levels',()=>{
 expect(buildPrompt(task,{kind:'none',base:'https://example.test'},{vision:false})).toContain('cannot view images');
 expect(buildPrompt(task,TOKEN,{promptLevel:'hardcore',vision:false})).toContain('cannot view images');
});
