import {expect,it} from 'vitest';
import {validateMarkupStructure} from '../local-validation';
it('shares structural validation without publication capabilities',()=>{
 expect(validateMarkupStructure('<p>hello</p>').errors).toEqual([]);
 expect(validateMarkupStructure('<p onClick="bad">hello</p>').errors.length).toBeGreaterThan(0);
 expect(validateMarkupStructure('<Helmet><Query name="q" source="abc123">{`select * from public.rows`}</Query></Helmet><Table data="$q" />').errors.some(e=>e.message.includes('ref:abc123'))).toBe(true);
 expect(validateMarkupStructure('<p>').errors.length).toBeGreaterThan(0);
});
