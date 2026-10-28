import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCommand} from '../src/platform';
import {updateCli} from '../src/update';

test('Windows browser handoff treats URL shell characters as literal data',()=>{
 const url="https://example.test/approve?a=1&next=$(touch nope)'";
 const command=browserCommand(url,'win32');
 assert.equal(command.file,'powershell.exe');
 assert.ok(command.args.includes('-EncodedCommand'));
 const script=Buffer.from(command.args.at(-1)!,'base64').toString('utf16le');
 assert.equal(script,`$env:PSModulePath=$PSHOME+'\\Modules'; Start-Process -FilePath '${url.replace(/'/g,"''")}'`);
 assert.deepEqual(browserCommand(url,'darwin'),{file:'open',args:[url]});
 assert.deepEqual(browserCommand(url,'linux'),{file:'xdg-open',args:[url]});
});

test('Windows update dry run names the npm install without invoking npm',async()=>{
 const dry=await updateCli({platform:'win32',home:'/unused',server:'https://example.test',harnesses:[],dryRun:true,fetch:async()=>Response.json({version:'2.0.0',protocol:3}),npm:async()=>assert.fail('no npm on a dry run')});
 assert.equal('command' in dry?dry.command:undefined,'npm install -g @afbin/cli@2.0.0');

});
