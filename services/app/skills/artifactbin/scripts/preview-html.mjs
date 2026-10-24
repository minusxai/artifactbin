// The downloadable archive bundles this parser; installed previews need only Node.
import {parse,parseFragment,serialize} from 'parse5';
export function previewHtml(source,notice){
 const document=parse(source);
 const html=document.childNodes.find(node=>node.nodeName==='html');
 html.attrs=html.attrs.filter(attr=>attr.name!=='data-af-private-preview');
 html.attrs.push({name:'data-af-private-preview',value:'true'});
 const body=html.childNodes.find(node=>node.nodeName==='body');
 for(const node of parseFragment(notice).childNodes){node.parentNode=body;body.childNodes.push(node);}
 return serialize(document);
}
