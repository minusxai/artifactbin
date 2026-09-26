/**
 * Where a document's data comes from, as the GRAMMAR sees it: an `<Import>`
 * names an artifact its SQL reads under that name, and `source=` survives
 * only on a `<Query>` (a connected Postgres database runs it). What the SQL
 * itself reads is the compiler's (lib/story/compile-dataflow), not the parser's.
 */
import {expect,it} from 'vitest';
import {parseJsx} from '@/lib/jsx';
import {splitHelmet} from '../helmet';
import { parseQueryDecl, parseMutationDecl } from '../dataflow';
import {collectRefUses} from '../refs';
const read=(source:string)=>{const p=parseJsx(source);if(!p.ok)throw Error('parse failed');return splitHelmet(p.nodes);};
const element=(source:string)=>{const p=parseJsx(source);if(!p.ok||p.nodes[0]?.type!=='element')throw Error('parse failed');return p.nodes[0];};

it('declares an import under its own name, independently of the SQL that reads it',()=>{
 const s='<Helmet><Import name="events" src="ref:abc123" /><Query name="q">{`select * from events.rows`}</Query></Helmet>';
 const {content}=read(s);
 expect(content.imports).toMatchObject([{name:'events',ref:'abc123'}]);
 expect(content.queries[0]).toMatchObject({name:'q',sql:'select * from events.rows'});
 expect(content.queries[0]!.source).toBeUndefined();
 expect(collectRefUses(s)).toEqual([{id:'abc123',kind:'dataset',via:'sql'}]);
});

it('keeps source= on a connected-database query, and refuses it on a mutation, pointing at <Import>',()=>{
 expect(read('<Helmet><Query name="q" source="ref:pg0001">{`select * from public.orders`}</Query></Helmet>').content.queries[0]).toMatchObject({source:'pg0001'});
 const m=parseMutationDecl(element('<Mutation name="edit" source="ref:abc123">{`update rows set n=2`}</Mutation>'));
 expect(m.ok).toBe(false);
 if(!m.ok)expect(JSON.stringify(m.errors)).toContain('<Import');
});

it('names source in the supported query attribute guidance', () => {
 const result = parseQueryDecl(element('<Query name="q" source="ref:abc123" unsupported="x">{`select * from public.rows`}</Query>'));
 expect(result.ok).toBe(false);
 if (!result.ok) expect(JSON.stringify(result.errors)).toContain('source=');
});

it('rejects a bare source ID with the canonical replacement in the diagnostic', () => {
 const result = parseQueryDecl(element('<Query name="q" source="abc123">{`select * from public.rows`}</Query>'));
 expect(result.ok).toBe(false);
 if (!result.ok) expect(JSON.stringify(result.errors)).toContain('ref:abc123');
});

it('refuses an import without a name or a ref, and an import with children', () => {
 const {content}=read('<Helmet><Import src="ref:abc123" /><Import name="x" /><Import name="y" src="ref:abc123">text</Import></Helmet>');
 expect(content.imports).toEqual([]);
});
