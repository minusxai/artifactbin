import { ARTIFACT_ID_PATTERN } from '@artifactbin/contracts';
import type { LocalPublicationBody, LocalPublicationPlan, LocalPublicationReceipt, LocalPublicationRequest } from './contracts';

type Fetch = typeof fetch;
async function answer(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) {
    const detail = Array.isArray(body?.details) ? body.details.filter(value => typeof value === 'string').join(' ') : null;
    throw new Error(detail || (response.status === 401 ? 'Sign in to publish this document.' : 'Publication could not finish. Retry with the same selected files.'));
  }
  return body;
}
export async function inspectLocalPublication(body: LocalPublicationBody, send: Fetch = fetch): Promise<LocalPublicationPlan> {
  return await answer(await send('/api/my/local-publications/plan', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) as unknown as LocalPublicationPlan;
}
/** Freezes both key and bytes before the first write. The caller keeps this object on retry. */
export function localPublicationRequest(body: LocalPublicationBody, key: string = crypto.randomUUID()): LocalPublicationRequest {
  return { key, body: JSON.parse(JSON.stringify(body)) as LocalPublicationBody };
}
const digest = async (source: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export async function sendLocalPublication(request: LocalPublicationRequest, origin: string, send: Fetch = fetch): Promise<LocalPublicationReceipt> {
  const created = await answer(await send('/api/my/artifacts', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.key }, body: JSON.stringify(request.body) }));
  if (typeof created.id !== 'string' || !ARTIFACT_ID_PATTERN.test(created.id)) throw new Error('The publication receipt did not identify a saved document. Retry publication.');
  // A transport retry may recover a committed creation; always read its admitted, normalized source.
  const head = await answer(await send(`/api/my/artifacts/${created.id}`, { credentials: 'same-origin' }));
  if (typeof head.html !== 'string' || typeof head.version !== 'number') throw new Error('The saved document source is unavailable. Retry publication to recover it.');
  const receipts = Array.isArray(created.dependencyReceipts) ? created.dependencyReceipts : [];
  const dependencyIdentity: Record<string, string> = Object.create(null);
  for (const value of receipts) if (value && typeof value === 'object' && typeof value.path === 'string' && typeof value.id === 'string') dependencyIdentity[value.path] = value.id;
  return { identity: { platformOrigin: origin, artifactId: created.id, baseRevision: String(head.version), sourceDigest: await digest(head.html), ...(Object.keys(dependencyIdentity).length ? { dependencyIdentity } : {}) }, source: head.html, localSourceDigest: await digest(request.body.html), ...(Object.keys(dependencyIdentity).length ? { dependencyIdentity } : {}) };
}
