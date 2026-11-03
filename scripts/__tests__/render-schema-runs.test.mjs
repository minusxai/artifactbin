import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';

// render-schema finds each service's Table data among its schema module's exports, a reflective use no import graph
// (knip included) can see: an export removed as "unused" breaks the schema render on main.
it('renders the schema and matches the checked-in SCHEMA.sql',()=>{
 const root=new URL('../../',import.meta.url);
 const out=JSON.parse(execFileSync(process.execPath,['scripts/render-schema.mjs','--json'],{cwd:root,encoding:'utf8',timeout:20_000}));
 expect(out.schema).toBe(readFileSync(new URL('SCHEMA.sql',root),'utf8'));
},20_000);
