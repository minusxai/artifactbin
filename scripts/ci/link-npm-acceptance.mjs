/** Only native acceptance tooling: product consumers install the release tarball independently. */
import {symlink,readlink} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const target=join(repository,'scripts/ci/npm-acceptance/node_modules'),link=join(repository,'node_modules');
try{await symlink(target,link,process.platform==='win32'?'junction':'dir');}
catch(error){if(error.code!=='EEXIST'||resolve(await readlink(link))!==target)throw error;}
