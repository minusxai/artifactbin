import {test} from 'node:test';
import assert from 'node:assert/strict';
import {browserCommand} from '../src/platform';
import {updateCli} from '../src/update';
import {scheduleBackgroundUpdate,runBackgroundUpdate} from '../src/background-update';

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

test('Windows update gives npm instructions before touching state or network',async()=>{
 assert.match((await updateCli({platform:'win32',home:'/unused',server:'https://example.test',harnesses:[],fetch:async()=>assert.fail('no network')})).command,/npx/);
 let launched=false,updated=false;
 const options={platform:'win32',standalone:true,home:'/unused',server:'https://example.test',launch:()=>{launched=true;},update:async()=>{updated=true;}};
 await scheduleBackgroundUpdate(options);await runBackgroundUpdate(options);
 assert.equal(launched,false);assert.equal(updated,false);
});
