import {expect,it} from 'vitest';
import {parseJsx} from '@/lib/jsx';
import {splitHelmet} from '../helmet';
import { parseQueryDecl, parseMutationDecl } from '../dataflow';
import {collectRefUses} from '../refs';
const read=(source:string)=>{const p=parseJsx(source);if(!p.ok)throw Error('parse failed');return splitHelmet(p.nodes);};
it('declares a query source independently of SQL table names',()=>{
 const s='<Helmet><Query name="q" source="ref:abc123">{`select * from analytics.events`}</Query></Helmet>';
 const q=read(s).content.queries[0];expect(q).toMatchObject({source:'abc123',refs:['abc123'],sql:'select * from analytics.events'});
 expect(collectRefUses(s)).toEqual([{id:'abc123',kind:'dataset',via:'sql'}]);
});
it('declares a mutation source without inspecting table count',()=>{
 const m=read('<Helmet><Mutation name="edit" source="ref:abc123">{`update public.rows set n=2`}</Mutation></Helmet>').content.mutations[0];
 expect(m).toMatchObject({source:'abc123',target:'abc123',refs:['abc123']});
});
it('refuses mixed legacy refs and explicit sources',()=>{
 const q=read('<Helmet><Query name="q" source="ref:abc123">{`select * from ref_def456`}</Query></Helmet>');
 expect(q.content.queries).toHaveLength(0);
});

it('names source in the supported query and mutation attribute guidance', () => {
 for (const tag of ['Query', 'Mutation']) {
  const parsed = parseJsx(`<${tag} name="q" source="ref:abc123" unsupported="x">{\`select * from public.rows\`}</${tag}>`);
  if (!parsed.ok || parsed.nodes[0]?.type !== 'element') throw new Error('parse failed');
  const result = (tag === 'Query' ? parseQueryDecl : parseMutationDecl)(parsed.nodes[0]);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(JSON.stringify(result.errors)).toContain('source=');
 }
});

it('rejects bare source IDs with the canonical replacement in the diagnostic', () => {
 for (const tag of ['Query', 'Mutation']) {
  const parsed = parseJsx(`<${tag} name="q" source="abc123">{\`select * from public.rows\`}</${tag}>`);
  if (!parsed.ok || parsed.nodes[0]?.type !== 'element') throw new Error('parse failed');
  const result = (tag === 'Query' ? parseQueryDecl : parseMutationDecl)(parsed.nodes[0]);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(JSON.stringify(result.errors)).toContain('ref:abc123');
 }
});

it('rejects implicit SQL artifact references but leaves quoted text and comments inert', () => {
 const invalid = read('<Helmet><Query name="q">{`select * from ref_abc123`}</Query></Helmet>');
 expect(invalid.content.queries).toHaveLength(0);
 const valid = read('<Helmet><Query name="q" source="ref:abc123">{`select \'ref_def456\' as label from public.rows /* ref_def456 */`}</Query></Helmet>');
 expect(valid.content.queries).toHaveLength(1);
});
