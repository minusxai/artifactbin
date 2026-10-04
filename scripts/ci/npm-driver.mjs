/** Find npm's JavaScript entry without depending on npm lifecycle environment variables. */
import {existsSync,realpathSync} from 'node:fs';
import {join,dirname,delimiter} from 'node:path';
export function npmDriver(){
 const candidates=[join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
 for(const directory of (process.env.PATH??'').split(delimiter)){
  if(!directory)continue;
  const command=join(directory,process.platform==='win32'?'npm.cmd':'npm');
  if(!existsSync(command))continue;
  candidates.push(process.platform==='win32'?join(dirname(realpathSync(command)),'node_modules/npm/bin/npm-cli.js'):realpathSync(command));
 }
 const driver=candidates.find(candidate=>existsSync(candidate));
 if(!driver)throw new Error('Cannot locate npm CLI from the active Node installation or PATH.');
 return driver;
}
