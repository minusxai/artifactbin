import { randomUUID } from 'node:crypto';
import { normalizePath } from '../path-model.ts';
import type { SqlDatabase } from '../persistence/sql.ts';
import { loadSession } from '../persistence/document-records.ts';
import { namespaceOwner } from '../group-authority.ts';
import { pathLock, readPaths } from '../persistence/paths.js';
import { hash } from '../server/text.ts';
import { fail } from '../errors.ts';
import { listTrash } from './repository.ts';
import { restorePaths } from './model.ts';
export function createTrashService(database: SqlDatabase, account: (session: Awaited<ReturnType<typeof loadSession>>) => string) {
  return {
    async handle(credential: string, url: URL, method: string, input: unknown = {}, now = Date.now()) {
      if (url.pathname !== '/api/trash' && url.pathname !== '/api/trash/folders' && !/^\/api\/trash\/[A-Za-z0-9-]+\/restore$/.test(url.pathname)) return null;
      return database.transaction(async client => {
        const session = await loadSession(client, hash(credential));
        const actor = account(session);
        const owner = namespaceOwner(actor, url.searchParams.get('owner') ?? undefined, true, session?.groupAuthority);
        if (url.pathname === '/api/trash' && method === 'GET') return { entries: await listTrash(client, owner) };
        if (method !== 'POST') fail(405, 'Method not allowed');
        await pathLock(client, owner);
        if (url.pathname === '/api/trash/folders') {
          const path = normalizePath(String((input as { path?: unknown })?.path ?? ''));
          const entries = await readPaths(client, owner);
          if (!path || !entries.some(e => e.path === path && !e.fileId)) fail(404, 'Folder not found');
          const subtree = entries.filter(e => e.path === path || e.path.startsWith(path + '/'));
          const folders = subtree.filter(e => !e.fileId).map(e => e.path);
          const ids = subtree.flatMap(e => e.fileId ? [e.fileId] : []);
          const id = randomUUID();
          await client.query('INSERT INTO trash_folders(id,owner,path,deleted_at,folders,file_ids) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [id,owner,path,now,JSON.stringify(folders),JSON.stringify(ids)]);
          await client.query('UPDATE files SET deleted_at=$3,trash_path=path,trash_batch=$4 WHERE owner=$1 AND id=ANY($2::text[])', [owner,ids,now,id]);
          await client.query('DELETE FROM folders WHERE owner=$1 AND path=ANY($2::text[])', [owner,folders]);
          return { id, deletedIds: ids };
        }
        const id = url.pathname.split('/')[3]!;
        const batch = (await client.query('SELECT path,folders,file_ids FROM trash_folders WHERE id=$1 AND owner=$2 FOR UPDATE', [id,owner])).rows[0];
        if (batch) {
          const files = (await client.query('SELECT id,trash_path FROM files WHERE owner=$1 AND trash_batch=$2 FOR UPDATE', [owner,id])).rows;
          const root = { id, path: String(batch.path), kind: 'folder' as const };
          const items = [...(batch.folders as string[]).map(path => ({id: path,path,kind: 'folder' as const})), ...files.map(r => ({id:String(r.id),path:String(r.trash_path),kind:'page' as const}))];
          const restored = restorePaths(items, root, (await readPaths(client,owner)).map(e => e.path));
          for (const item of restored) {
            if (item.kind === 'folder') await client.query('INSERT INTO folders(owner,path) VALUES($1,$2)', [owner,item.path]);
            else await client.query('UPDATE files SET path=$2,deleted_at=NULL,trash_path=NULL,trash_batch=NULL WHERE id=$1', [item.id,item.path]);
          }
          await client.query('DELETE FROM trash_folders WHERE id=$1', [id]);
          return { id, path: restored[0]?.path, restoredIds: files.map(r => String(r.id)) };
        }
        const row = (await client.query('SELECT id,trash_path FROM files WHERE id=$1 AND owner=$2 AND deleted_at IS NOT NULL AND trash_batch IS NULL FOR UPDATE', [id, owner])).rows[0];
        if (!row) fail(404, 'File not found');
        const item = { id, path: String(row.trash_path), kind: 'page' as const };
        const restored = restorePaths([item], item, (await readPaths(client, owner)).map(e => e.path))[0]!;
        await client.query('UPDATE files SET path=$2,deleted_at=NULL,trash_path=NULL WHERE id=$1', [id, restored.path]);
        return { id, path: restored.path, restoredIds: [id] };
      });
    },
  };
}
