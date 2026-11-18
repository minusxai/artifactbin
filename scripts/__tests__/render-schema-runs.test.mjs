import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {describe,expect,it} from 'vitest';

const root=new URL('../../',import.meta.url);
// Each render is a Node process of its own (tsx, PGlite and every schema module: 5-7s apiece on a pr fast guard runner),
// so the renders run side by side: one after another they made this the lane's longest guard file (12.5s).
const render=(...args)=>promisify(execFile)(process.execPath,['scripts/render-schema.mjs','--json',...args],{cwd:root,encoding:'utf8',timeout:20_000});

describe.concurrent('render-schema',()=>{
 // render-schema finds each service's Table data among its schema module's exports, a reflective use no import graph
 // (knip included) can see: an export removed as "unused" breaks the schema render on main.
 it('renders the schema and matches the checked-in SCHEMA.sql',async()=>{
  const out=JSON.parse((await render()).stdout);
  expect(out.schema).toBe(readFileSync(new URL('SCHEMA.sql',root),'utf8'));
 },20_000);

 // Another service that reads identity gets exactly the app's identity grants for its own role, and nothing else.
 it('--reader-role adds another reader of the identity views and refuses a name that is not one',async()=>{
  const [extra,refused]=await Promise.all([render('--reader-role','svc_reader'),render('--reader-role','x; drop').then(()=>({code:0}),(error)=>error)]);
  const parsed=JSON.parse(extra.stdout);
  expect(parsed.roles).toContain('GRANT USAGE ON SCHEMA identity TO svc_reader;');
  expect(parsed.grants.split('\n').filter(line=>line.includes('svc_reader'))).toEqual([
   'GRANT SELECT ON ALL TABLES IN SCHEMA identity TO svc_reader;',
   'ALTER DEFAULT PRIVILEGES FOR ROLE artifactbin_auth IN SCHEMA identity GRANT SELECT ON TABLES TO svc_reader;',
  ]);
  expect(refused.code).toBe(2);
 },40_000);
});
