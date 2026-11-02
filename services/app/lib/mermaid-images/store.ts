import { getDb } from '@/lib/platform';
import { objectStore } from '@/lib/object-store';
export const MERMAID_IMAGE_FILE = /^([0-9a-f]{64})\.svg$/;
/** Capture mode; the caller has already verified the export key. */
export function captureColor(url: string | URL): 'light' | 'dark' | null {
  const value = new URL(url).searchParams.get('color');
  return value === 'light' || value === 'dark' ? value : null;
}
/** A stored drawing's bytes, for app/assets/mermaid/[file]; null when there is none. */
export async function mermaidImageBytes(key: string): Promise<Buffer | null> {
  if (!/^[0-9a-f]{64}$/.test(key)) return null;
  const db = await getDb();
  const row = (await db.query<{ object_key: string }>('SELECT object_key FROM mermaid_images WHERE key=$1', [key])).rows[0];
  if (!row) return null;
  try { return await objectStore().get(row.object_key); } catch { return null; }
}
