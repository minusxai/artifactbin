/**
 * PUBLISH CHECKS THE PAGE'S GRAPHQL NAMES: a resolver's `caps.query` runs against the page's GraphQL, where a linked
 * dataset appears under its link name (`data-af-name`), never under its own API name. A save whose resolver (or
 * page script) names the dataset's own root is refused with the exact replacement, before anything is written; the
 * same page under its page names publishes.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { mintAccountToken, setSession, useAppHarness } from './harness';
import { identityForUser, type AccessActor } from '@/lib/accounts';
import { createArtifactFromBody, replaceArtifactWithBody } from '@/lib/publish';

// Resolver compilation needs the runner (covered on its own); the schema is the source's typeDefs literal.
vi.mock('@/lib/page-operations', async (original) => ({ ...await original<typeof import('@/lib/page-operations')>(), compilePageBackend: async (source: string) => ({ typeDefs: /export const typeDefs = '([^']*)'/.exec(source)![1]!, compiled: source }) }));
useAppHarness();
beforeEach(() => setSession(null));

async function owner() {
  const token = await mintAccountToken('pgn_owner');
  return identityForUser(token.userId, token.id, token.email) as AccessActor & { tokenId: string };
}
async function publish(actor: AccessActor & { tokenId: string }, body: Record<string, unknown>) {
  const created = await createArtifactFromBody({ ...('dataset' in body ? { access: 'readwrite' } : {}), visibility: 'unlisted', ...body }, actor, 'http://localhost:3000');
  return { status: created.status, body: await created.json() as { id: string; version: number; state: string; error?: string; details?: string[]; hint?: string } };
}
const page = (dataset: string, script = '') => `<html><head><link rel="af-dataset" data-af-name="notes" href="ref:${dataset}"><link rel="af-resolver" data-af-name="deals" href="./deals.ts"></head><body>Deals${script ? `<script type="module">${script}</script>` : ''}</body></html>`;
const resolver = (mutation: string) => `export const typeDefs = 'type Mutation { addNote(note: String!): ID! @auth(role: signed_in) }';
export default { async addNote(args: { note: string }, _p: unknown, caps: { query(q: string, v?: object): Promise<any> }) {
  return (await caps.query('${mutation}', { o: { note: args.note } })).insert_notes_one._id;
} };`;
const WRONG = 'mutation Add($o: deal_notes_insert_input!){ insert_deal_notes_one(object:$o){_id} }';
const RIGHT = 'mutation Add($o: notes_insert_input!){ insert_notes_one(object:$o){_id} }';

it('refuses a resolver that names the dataset by its own API name, naming the page-name replacement', async () => {
  const actor = await owner();
  const dataset = await publish(actor, { dataset: [{ note: 'first', deal: 'acme' }], title: 'Deal Notes' });
  expect(dataset.status).toBe(201);
  const refused = await publish(actor, { html: page(dataset.body.id), resolverSources: { deals: resolver(WRONG) } });
  expect(refused.status, JSON.stringify(refused.body)).toBe(400);
  expect(refused.body.error, JSON.stringify(refused.body)).toBe('invalid_page_graphql');
  expect(refused.body.details).toEqual(['resolver deals.ts: insert_deal_notes_one is not on this page; the dataset is linked as "notes": use insert_notes_one (and notes_insert_input)']);
  expect(refused.body.hint).toMatch(/data-af-name/);

  const published = await publish(actor, { html: page(dataset.body.id), resolverSources: { deals: resolver(RIGHT) } });
  expect(published.status, JSON.stringify(published.body)).toBe(201);

  // A replace is checked the same way, and the page's own static queries with it.
  const replaced = await replaceArtifactWithBody({ html: page(dataset.body.id, "import {gql} from '@afbin/apollo';const q=gql`{ deal_notes(limit: 5) { _id note } }`;"), resolverSources: { deals: resolver(RIGHT) }, expectedVersion: published.body.version, expectedState: published.body.state }, actor, published.body.id, 'http://localhost:3000');
  expect(replaced.status).toBe(400);
  expect((await replaced.json() as { details: string[] }).details).toEqual(['page: deal_notes is not on this page; the dataset is linked as "notes": use notes']);
});
