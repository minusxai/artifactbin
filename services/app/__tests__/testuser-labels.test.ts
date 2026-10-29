/** Test identities retain the display name shown by retained person projections. */
import { expect, it } from 'vitest';
import { request, useAppHarness, mintAccountToken } from './harness';
import { POST as newTestUser } from '@/app/api/testusers/route';
import { claimToken } from '@/lib/authentication';
import { createUser } from '@/lib/accounts';
import { people } from '@/lib/datasets/user-fields';
import { getDb } from '@/lib/platform/db';

useAppHarness();
it('labels a test user for the account viewing its data', async () => {
  const owner = await createUser({ email: 'mxmx_test_labels@example.com' });
  const token = await mintAccountToken('owner', owner.id);
  await claimToken(owner.id, token.token);
  const response = await newTestUser(request('/api/testusers', { method: 'POST', token: token.token, json: {} }));
  expect(response.status).toBe(201);
  const { id, label } = await response.json() as { id: string; label: string };
  expect(label).toMatch(/^Test user /);
  const cards = await people(await getDb(), [id, 'missing-person']);
  expect(cards[id]?.name).toBe(label);
  expect(cards).not.toHaveProperty('missing-person');
  expect(cards[id]).not.toHaveProperty('email');
});
