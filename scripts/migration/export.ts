import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { exportLegacy } from '../../src/migration/export.ts';
const require=createRequire(import.meta.url);
const {Client}=require('pg');
const [schema,namespace,output]=process.argv.slice(2);
if(!schema||!namespace||!output||!process.env.MIGRATION_SOURCE_DATABASE_URL)throw new Error('Usage: MIGRATION_SOURCE_DATABASE_URL=… node --experimental-strip-types scripts/migration/export.ts <explicit-schema> <namespace> <private-output.json>');
const client=new Client({connectionString:process.env.MIGRATION_SOURCE_DATABASE_URL});
await client.connect();
try{const manifest=await exportLegacy(client,{schema,sourceNamespace:namespace,now:()=>new Date()});await writeFile(output,JSON.stringify(manifest),{mode:0o600,flag:'wx'});}finally{await client.end();}
