/**
 * The hosted libraries' served addresses: under the public files' `/af/lib/` (server/public-files), each pinned by its
 * version. Apart from vega-libraries.test.ts (which bundles and loads Vega) so it runs in pr fast's node batch.
 */
import {expect,it} from 'vitest';
import {libraryUrls} from '../index';

it('advertises separate explicitly pinned Vega and Vega-Lite module URLs',()=>{
 expect(libraryUrls('https://example.invalid')).toMatchObject({vega:'https://example.invalid/af/lib/vega-6.3.1/index.js','vega-lite':'https://example.invalid/af/lib/vega-lite-6.4.3/index.js'});
});
