/** The offline module table's one block name: where the packer writes it and what the portable copy reads back. */
import {expect,it} from 'vitest';
import {packOfflineDependencies} from '..';
import {OFFLINE_MODULES_BLOCK} from '../contracts';

const baseUrl='https://example.test/a/page/';
const js=(url:string,text:string)=>({url,contentType:'text/javascript',bytes:new TextEncoder().encode(text)});
const blocks=(html:string)=>[...html.matchAll(new RegExp(`<script type="application/json" data-af="${OFFLINE_MODULES_BLOCK}">(.*?)</script>`,'gs'))].map(match=>match[1]!);

it('writes one JSON table first in the head, with every < escaped so module text cannot close it',async()=>{
 expect(OFFLINE_MODULES_BLOCK).toBe('offline-modules');
 const source='export const tag="</script><b>é</b>";';
 const {html}=await packOfflineDependencies({html:'<html><head><title>t</title></head><body><script type="module">import {tag} from "./tag.js";document.body.append(tag);</script></body></html>',baseUrl,resources:[js('./tag.js',source)]});
 expect(html.startsWith(`<html><head><script type="application/json" data-af="${OFFLINE_MODULES_BLOCK}">`)).toBe(true);
 const [payload,...more]=blocks(html);
 expect(more).toEqual([]);
 expect(payload).not.toContain('<');
 expect(Object.values(JSON.parse(payload!) as Record<string,string>)).toEqual([source]);
});

it('writes no table when nothing is a shared module',async()=>{
 const html='<html><head></head><body><p>☕ nothing to embed</p></body></html>';
 const packed=await packOfflineDependencies({html,baseUrl,resources:[]});
 expect(packed.html).toBe(html);
 expect(blocks(packed.html)).toEqual([]);
});
