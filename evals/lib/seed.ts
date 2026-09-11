import { DRIVER_HEADER } from './proxy';
/** Publish the document a task asks the agent to EDIT, as the agent's own token would have. */
export async function seedDocument(base: string, id: string, token: string, markup: string, call: typeof fetch = fetch): Promise<void> {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}`, [DRIVER_HEADER]: '1' };
  const observed = await call(`${base}/api/artifacts/${id}`, { headers });
  if (!observed.ok) throw new Error(`observing seed ${id} → ${observed.status}`);
  const head = await observed.json() as { version?: number; state?: string };
  if (!Number.isInteger(head.version) || !head.state) throw new Error('Seed observation is missing version/state');
  const res = await call(`${base}/api/artifacts/${id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ markup, expectedVersion: head.version, expectedState: head.state }),
  });
  if (!res.ok) throw new Error(`seeding document ${id} → ${res.status} ${await res.text()}`);
}

