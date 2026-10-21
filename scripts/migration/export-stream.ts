import {createRequire} from 'node:module';
import {exportLegacyStream} from '../../src/migration/stream.ts';
const [schema,namespace,directory]=process.argv.slice(2);
if(!schema||!namespace||!directory||!process.env.MIGRATION_SOURCE_DATABASE_URL)throw new Error('Usage: MIGRATION_SOURCE_DATABASE_URL=… node --experimental-strip-types scripts/migration/export-stream.ts <explicit-schema> <namespace> <new-private-directory>');
const require=createRequire(import.meta.url);const {Client}=require('pg');const client=new Client({connectionString:process.env.MIGRATION_SOURCE_DATABASE_URL});const controller=new AbortController();process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
await client.connect();try{const manifest=await exportLegacyStream(client,{schema,sourceNamespace:namespace,directory,now:()=>new Date(),signal:controller.signal});process.stdout.write(JSON.stringify({parts:manifest.parts.length,rows:manifest.parts.reduce((n,p)=>n+p.rows,0),bytes:manifest.parts.reduce((n,p)=>n+p.bytes,0)})+'\n');}finally{await client.end();}
