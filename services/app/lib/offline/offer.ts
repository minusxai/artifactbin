/** Parse the inert JSON payload. No HTML, script or offered styles are mounted or evaluated. */
import {parse,type DefaultTreeAdapterMap} from 'parse5';
import {PREVIEW_CONNECT_MAX_BYTES} from '@artifactbin/contracts';
import {parseArtifactFile,type ArtifactFile} from './file-format';
interface FileOffer {html:string;filename:string}
export function readFileOffer(value:unknown):{offer:FileOffer;file:ArtifactFile} {
 if(!value||typeof value!=='object')throw Error('Choose an artifactbin HTML file.');
 const input=value as Partial<FileOffer>;
 if(typeof input.html!=='string'||Buffer.byteLength(input.html)>PREVIEW_CONNECT_MAX_BYTES||typeof input.filename!=='string'||input.filename.length>255)throw Error('Choose an artifactbin HTML file smaller than 25 MB.');
 return {offer:input as FileOffer,file:readArtifactFileHtml(input.html)};
}
export function readArtifactFileHtml(html:string):ArtifactFile {
 if(Buffer.byteLength(html)>PREVIEW_CONNECT_MAX_BYTES)throw Error('The HTML file exceeds the 25 MB import limit.');
 const blocks:string[]=[];
 const visit=(node:DefaultTreeAdapterMap['node'])=>{
  if('tagName' in node&&node.attrs.some(attr=>attr.name==='id'&&attr.value==='afbin-file')){
   if(node.tagName!=='script'||!node.attrs.some(attr=>attr.name==='type'&&attr.value==='application/json'))throw Error('Invalid artifact file payload.');
   blocks.push(node.childNodes.map(child=>'value' in child?child.value:'').join(''));
  }
  if('childNodes' in node)for(const child of node.childNodes)visit(child);
 };
 visit(parse(html));
 if(blocks.length!==1)throw Error('Expected exactly one artifact file payload.');
 return parseArtifactFile(JSON.parse(blocks[0]!));
}
