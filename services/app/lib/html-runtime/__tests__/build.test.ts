import {gzipSync} from 'node:zlib';
import { expect, it } from 'vitest';
import { buildHtmlCore } from '../build.server';
import { downloadableHtml } from '../index';
it('builds a classic bootstrap and a self-contained downloadable page', async () => {
  const core = await buildHtmlCore();
  expect(() => new Function(core)).not.toThrow();
  const html = downloadableHtml({ html: '<html><body><h1 data-af-id="n1">Hello</h1></body></html>', core, config: { pageId: 'p1', revision: '1', backends: [] } });
  expect(html).toContain('@afbin/apollo');
  expect(html).toContain('"offline":true');
  expect(html).not.toContain('src="');
});

it('keeps the portable core compressed payload below its minified portable payload ceiling',async()=>{
 expect(gzipSync(await buildHtmlCore()).byteLength).toBeLessThan(25*1024);
});
