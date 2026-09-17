import {createRequire} from 'node:module';
/** SEA-only worker entry. The sandbox mounts these fixed modules and dependencies read-only. */
export async function startBrowserWorker():Promise<void>{
 // A real-file CJS module owns the dynamic import so SEA uses Node's filesystem ESM loader.
 const bootstrap='/runtime/worker-bootstrap.cjs';
 const load=createRequire(bootstrap)(bootstrap) as ()=>Promise<unknown>;
 await load();
}
