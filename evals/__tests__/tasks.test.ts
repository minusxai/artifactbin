import {expect,it} from 'vitest';
import {buildPrompt} from '../lib/tasks';
import {TaskSchema} from '../lib/contracts';
const task=TaskSchema.parse({id:'publish',brief:'Publish a report.',handoff:'token',checks:['published']});
it('teaches the local CLI without leaking the saved credential or fetching skills',()=>{
 const prompt=buildPrompt(task,{kind:'token',id:'abc123',base:'https://example.test',token:'mx_secret'});
 expect(prompt).toContain(task.brief);expect(prompt).toContain('abc123');expect(prompt).toContain('afbin pull');
 expect(prompt).toContain('~/.artifactbin/.env');expect(prompt).not.toMatch(/mx_secret|MCP|\/docs\//);
});
it('does not invent authentication for a task with no credential',()=>{
 const prompt=buildPrompt(task,{kind:'none',base:'https://example.test'});
 expect(prompt).toContain('not been given a token');expect(prompt).not.toContain('connection is saved');
});
it('tells text-only models to inspect markup',()=>{
 expect(buildPrompt(task,{kind:'none',base:'https://example.test'},{vision:false})).toContain('cannot view images');
});
