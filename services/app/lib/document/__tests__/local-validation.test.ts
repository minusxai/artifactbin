import {expect,it} from 'vitest';
import {validateMarkupStructure} from '../local-validation';
it('shares structural validation without publication capabilities',()=>{
 expect(validateMarkupStructure('<p>hello</p>').errors).toEqual([]);
 expect(validateMarkupStructure('<p onClick="bad">hello</p>').errors.length).toBeGreaterThan(0);
 expect(validateMarkupStructure('<Helmet><Query name="q" source="abc123">{`select * from public.rows`}</Query></Helmet><Table data="$q" />').errors.some(e=>e.message.includes('ref:abc123'))).toBe(true);
 expect(validateMarkupStructure('<p>').errors.length).toBeGreaterThan(0);
});

it('refuses source= on a mutation at the grammar, pointing at <Import>',()=>{
 const {errors}=validateMarkupStructure('<Helmet><Import name="bookings" src="ref:BookRows1" /><Mutation name="m" source="ref:BookRows1">{`delete from public.rows`}</Mutation></Helmet>\n<main />');
 expect(errors.map(e=>e.message)).toContainEqual(expect.stringMatching(/<Mutation> takes no source= — import the dataset/));
});
it('accepts literal Markdown, checklists, dividers and aligned tables',()=>{
 for(const md of ['## Overview\n\nA **bold** point & more.\n\n- One\n- Two','- [ ] Open task\n- [x] Done task\n\n---\n\n| Name | Value |\n| :--- | ---: |\n| **Total** | 42 |'])
  expect(validateMarkupStructure(`<Markdown id="body">{${JSON.stringify(md)}}</Markdown>`).errors).toEqual([]);
});
it('refuses executable links, unsupported Markdown and nested JSX in a Markdown block',()=>{
 for(const md of ['[bad](javascript:alert)','<script>alert(1)</script>','![image](https://example.com/a.png)','> | A | B |\n> | --- | --- |\n> | C | D |'])
  expect(validateMarkupStructure(`<Markdown id="body">{${JSON.stringify(md)}}</Markdown>`).errors.length,md).toBeGreaterThan(0);
 expect(validateMarkupStructure('<Markdown><p>Nested JSX</p></Markdown>').errors.length).toBeGreaterThan(0);
});
