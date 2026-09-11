import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCommand, commandHelp, commands} from '../src/commands';

test('one flag vocabulary works before or after the command and aliases normalize',()=>{
 assert.deepEqual(parseCommand(['--json','push','a.jsx','-ny']),{command:'push',positionals:['a.jsx'],flags:{json:true,'dry-run':true,yes:true}});
 assert.equal(parseCommand(['ls','--limit','12']).command,'list');
 assert.equal(parseCommand(['rm','abc123']).command,'delete');
 assert.deepEqual(parseCommand(['setup','--harness','pi','--harness=opencode','-y']).flags,{harness:['pi','opencode'],yes:true});
 assert.deepEqual(parseCommand(['api','/artifacts','-XPOST','--input','-']).flags,{method:'POST',input:'-'});
 assert.deepEqual(parseCommand(['remote','--name','Work','pi','--model','deepseek','-h']).positionals,['pi','--model','deepseek','-h']);
 assert.deepEqual(parseCommand(['push','--','-report.jsx']).positionals,['-report.jsx']);
});
test('refuses inapplicable flags and malformed requests before any auth or network',()=>{
 for(const args of [['status','--force'],['help','--dry-run'],['push','--fix'],['pull','a','b','c'],['list','--limit','0'],['list','--limit','no'],['api'],['comment','a','--resolve'],['comment','a','--body','x','--body-file','x'],['setup','--harness','none','--harness','pi'],['push','--froce'],['push','--json=false']]) assert.throws(()=>parseCommand(args),Error,args.join(' '));
 assert.equal(parseCommand([]).command,'setup');
});
test('each command documents its actual flags and supports local short help',()=>{
 for(const command of commands){
   const parsed=parseCommand([command.name,'-h']);
   assert.equal(parsed.flags.help,true);
   const help=commandHelp(command.name);
   assert.ok(help.includes(`afbin ${command.name}`));
   for(const flag of command.flags) assert.ok(help.includes(`--${flag}`),`${command.name}: ${flag}`);
 }
});
test('rejects flags that cannot affect the selected operation',()=>{
 for(const args of [
  ['comment','abc123','--body','text','--node','heading','--limit','3'],
  ['comment','abc123','--reply','thread','--resolve','--cursor','next'],
  ['remote','--json','pi'],
 ])assert.throws(()=>parseCommand(args),Error,args.join(' '));
});
test('fixed choices ignore ASCII case but commands, flags and user arguments retain exact spelling',()=>{
 assert.deepEqual(parseCommand(['setup','--harness','CoDeX','--harness','PI']).flags.harness,['codex','pi']);
 assert.throws(()=>parseCommand(['setup','--harness','NONE','--harness','pi']));
 assert.throws(()=>parseCommand(['setup','--harness','pi','--harness','PI']));
 assert.throws(()=>parseCommand(['SETUP']));
 assert.throws(()=>parseCommand(['setup','--HARNESS','pi']));
 assert.deepEqual(parseCommand(['push','MiXeD.jsx']).positionals,['MiXeD.jsx']);
});
