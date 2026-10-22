import type { SqlClient } from '../persistence/sql.ts';
import type { TrashEntry } from './contracts.ts';
export async function listTrash(client: SqlClient, owner: string): Promise<TrashEntry[]> {
  return (await client.query(`SELECT id,trash_path AS path,deleted_at,'page' AS kind FROM files WHERE owner=$1 AND deleted_at IS NOT NULL AND trash_batch IS NULL UNION ALL SELECT id,path,deleted_at,'folder' AS kind FROM trash_folders WHERE owner=$1 ORDER BY deleted_at DESC,id`, [owner])).rows.map(r => ({ id: String(r.id), path: String(r.path), deletedAt: Number(r.deleted_at), kind: r.kind === 'folder' ? 'folder' : 'page' }));
}
