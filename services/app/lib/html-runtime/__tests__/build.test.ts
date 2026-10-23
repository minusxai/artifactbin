import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {gzipSync} from 'node:zlib';
import { expect, it } from 'vitest';
import { buildHtmlCore,buildHtmlAssets } from '../build.server';
import { downloadableHtml,assembleHtmlPage } from '../index';
it('builds a classic bootstrap and a self-contained downloadable page', async () => {
  const {core,apollo} = await buildHtmlAssets();
  expect(() => new Function(core)).not.toThrow();
  const html = downloadableHtml({ html: '<html><body><h1 data-af-id="n1">Hello</h1></body></html>', core, apollo, config: { pageId: 'p1', revision: '1', backends: [] } });
  expect(html).toContain('@afbin/apollo');
  expect(html).toContain('"offline":true');
  expect(html).not.toContain('src="');
});

it('keeps executable inline JavaScript in assembled static HTML under the 10 KiB budget',async()=>{
 const html=assembleHtmlPage({html:'<html><body><h1>Static report</h1></body></html>',core:await buildHtmlCore(),config:{pageId:'p',revision:'1',backends:[]}});
 const scripts:string[]=[];
 const visit=(node:DefaultTreeAdapterMap['node'])=>{
  if('attrs' in node&&node.nodeName==='script'&&!node.attrs.some(attr=>attr.name==='type'&&['application/json','importmap'].includes(attr.value)))scripts.push(node.childNodes.map(child=>'value' in child?child.value:'').join(''));
  if('childNodes' in node)for(const child of node.childNodes)visit(child);
 };
 for(const node of parse(html).childNodes)visit(node);
 expect(gzipSync(scripts.join('\n')).byteLength).toBeLessThan(10*1024);
});

it('hosted readers omit the author engine, while downloads carry the same module without network dependencies',async()=>{
 const assets=await buildHtmlAssets();
 expect(assets.apolloPath).toMatch(/^\/af\/v1\/apollo\/[a-f0-9]{64}$/);
 expect(assets.core).not.toContain(assets.apollo);
 const html=downloadableHtml({html:'<html><body></body></html>',core:assets.core,apollo:assets.apollo,config:{pageId:'p',revision:'1',backends:[]}});
 expect(html).toContain('data-af="apollo"');
 expect(JSON.parse(/data-af="apollo">([\s\S]*?)<\/script>/.exec(html)![1]!)).toBe(assets.apollo);
 expect(html).not.toContain('src="');
});
