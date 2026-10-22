import{gzipSync}from'node:zlib';import{createHash}from'node:crypto';
import{encodeAscii91,decodeAscii91}from'./ascii91.ts';
import{decodeCompiledJavascript}from'./javascript-payload-decode.ts';
import{decodeCompiledPage}from'./page-payload-decode.ts';
import{mountCompiledPayload}from'./javascript-payload-browser.ts';
import{startCompiledPayload}from'./javascript-payload-lifecycle.ts';
import type{CompiledAsciiPayload,CompiledPagePayload}from'./page-payload-contracts.ts';
export const compiledStylesheetPendingMarkup='<style data-af-compiled-style-pending>body{visibility:hidden!important}[data-migration-runtime-status]{visibility:visible!important}</style>';
/** Oversize offline fallback: retain every stylesheet/font and module byte. */
export function compiledPageMarkup(css:string,javascript:string):string{
 const pack=(source:string):CompiledAsciiPayload=>{const bytes=Buffer.from(source),packed=gzipSync(bytes,{level:9});if(!bytes.length||bytes.length>32*1024*1024||packed.length>3*1024*1024)throw Error('Compiled page stream exceeds limit');return {compression:'gzip',ascii91:encodeAscii91(packed),sha256:createHash('sha256').update(bytes).digest('hex'),uncompressedBytes:bytes.length};};
 const payload:CompiledPagePayload={stylesheet:css?pack(css):null,javascript:pack(javascript)};
 const loader=`(()=>{const __name=f=>f;const decode=${decodeCompiledJavascript.toString()},dense=${decodeAscii91.toString()},page=${decodeCompiledPage.toString()};(${mountCompiledPayload.toString()})(document,window,(payload,signal)=>page(payload,signal,decode,dense,document),${startCompiledPayload.toString()});})();`;
 return `<p data-migration-runtime-status role="status">Starting page…</p><script type="application/json" data-af-compiled-payload>${JSON.stringify(payload)}</script><script type="module">${loader}</script>`;
}
