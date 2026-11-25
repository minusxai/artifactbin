/** A host-only release handoff. A private Unix socket gates creation at the same registry that owns
 * active workers. Holding a busy registry leaves it open. Requests on the public service cannot reach this socket. */
import { chmod, lstat, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute } from 'node:path';
import { once } from 'node:events';

export async function openSessionHandoff(path: string, registry: {holdIfIdle(): boolean; resume(): void}) {
  if (!isAbsolute(path)) throw new Error('Browser handoff socket requires an absolute path');
  const directory=dirname(path);
  await mkdir(directory,{recursive:true,mode:0o700});
  const stat=await lstat(directory);
  if (!stat.isDirectory() || stat.uid!==process.getuid?.() || (stat.mode & 0o077)!==0)
    throw new Error('Browser handoff requires a private directory owned by the browser process');
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
