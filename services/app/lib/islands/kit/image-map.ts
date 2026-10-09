import { imageReferenceId } from '@/lib/dataflow/image-source';
import { ISLAND_DATA_ID } from '@/lib/story-runtime/contract';

/** Browser-only mapping for image selections; every request stays behind this document's asset door. */
export async function mapImage(value: string, row: boolean, endpoint: string | null, cache: Map<string, string>, signal: AbortSignal): Promise<string | null> {
  const id = imageReferenceId(value);
  if (row && id) return `/a/${id}/raw`;
  const cached = cache.get(value);
  if (cached) return cached;
  if (!id && !/^https?:\/\//i.test(value)) return null;
  let door = endpoint ?? undefined;
  if (!door) try { door = (JSON.parse(document.getElementById(ISLAND_DATA_ID)?.textContent ?? '{}') as { assetsUrl?: string }).assetsUrl; } catch { door = undefined; }
  if (!door) return null;
  const response = await fetch(`${door}${door.includes('?') ? '&' : '?'}u=${encodeURIComponent(value)}`, { headers: { Accept: 'application/json' }, signal });
  if (!response.ok) return null;
  const answer = await response.json() as { url?: string };
  if (answer.url) cache.set(value, answer.url);
  return answer.url ?? null;
}
