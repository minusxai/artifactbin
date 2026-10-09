import {readFileSync} from 'node:fs';
import path from 'node:path';
/** Exact helper bundled into CLI/ZIP skills; public code, no credentials. */
export async function GET(){
 return new Response(readFileSync(path.resolve(process.cwd(),'skills/artifactbin/scripts/credentials.mjs'),'utf8'),{headers:{
  'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store',
  'Content-Disposition':'attachment; filename="artifactbin-credentials.mjs"',
 }});
}
