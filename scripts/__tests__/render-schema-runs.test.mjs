import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

// render-schema finds each service's Table data among its schema module's exports, a reflective use no import graph
// (knip included) can see: an export removed as "unused" breaks the schema render on main.
it('renders the schema and matches the checked-in SCHEMA.sql',()=>{
 const root=new URL('../../',import.meta.url);
 const out=JSON.parse(execFileSync(process.execPath,['scripts/render-schema.mjs','--json'],{cwd:root,encoding:'utf8',timeout:20_000}));
 expect(out.schema).toBe(readFileSync(new URL('SCHEMA.sql',root),'utf8'));
},20_000);

// Another service that reads identity gets exactly the app's identity grants for its own role, and nothing else.
it('--reader-role adds another reader of the identity views and refuses a name that is not one',()=>{
 const root=new URL('../../',import.meta.url);
 const extra=JSON.parse(execFileSync(process.execPath,['scripts/render-schema.mjs','--json','--reader-role','svc_reader'],{cwd:root,encoding:'utf8',timeout:20_000}));
 expect(extra.roles).toContain('GRANT USAGE ON SCHEMA identity TO svc_reader;');
 expect(extra.grants.split('\n').filter(line=>line.includes('svc_reader'))).toEqual([
  'GRANT SELECT ON ALL TABLES IN SCHEMA identity TO svc_reader;',
  'ALTER DEFAULT PRIVILEGES FOR ROLE artifactbin_auth IN SCHEMA identity GRANT SELECT ON TABLES TO svc_reader;',
 ]);
 expect(spawnSync(process.execPath,['scripts/render-schema.mjs','--json','--reader-role','x; drop'],{cwd:root,timeout:20_000}).status).toBe(2);
},40_000);
