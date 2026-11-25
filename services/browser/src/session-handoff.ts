/** A host-only release handoff. A private Unix socket gates creation at the same registry that owns
 * active workers. Holding a busy registry leaves it open. Requests on the public service cannot reach this socket. */
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { dirname, isAbsolute } from 'node:path';
import { once } from 'node:events';

// SIGKILL leaves the socket entry behind. Only reclaim our own socket after the kernel
// confirms nobody listens there. Leave occupied paths to the normal bind error.
async function removeAbandonedSocket(path: string) {
  const existing=await lstat(path).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return undefined;
    throw error;
  });
  if (!existing?.isSocket() || existing.uid!==process.getuid?.()) return;
  const probe=createConnection(path);
  try { await once(probe,'connect'); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code!=='ECONNREFUSED') throw error; }
  finally { probe.destroy(); }
  const current=await lstat(path);
  if (current.dev===existing.dev && current.ino===existing.ino) await unlink(path);
}

export async function openSessionHandoff(path: string, registry: {holdIfIdle(): boolean; resume(): void}) {
  if (!isAbsolute(path)) throw new Error('Browser handoff socket requires an absolute path');
  const directory=dirname(path);
  await mkdir(directory,{recursive:true,mode:0o700});
  const stat=await lstat(directory);
  if (!stat.isDirectory() || stat.uid!==process.getuid?.() || (stat.mode & 0o077)!==0)
    throw new Error('Browser handoff requires a private directory owned by the browser process');
  await removeAbandonedSocket(path);
  const server=createServer((request,response)=>{
    if (request.method!=='POST') {response.writeHead(405).end();return;}
    if (request.url==='/hold') {response.writeHead(registry.holdIfIdle()?204:409).end();return;}
    if (request.url==='/resume') {registry.resume();response.writeHead(204).end();return;}
    response.writeHead(404).end();
  });
  server.listen(path);
  await once(server,'listening');
  try {await chmod(path,0o600);}
  catch (error) {server.close();throw error;}
  return () => new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
}
