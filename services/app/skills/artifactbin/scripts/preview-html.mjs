// The downloadable archive bundles this parser; installed previews need only Node.
import {parse,parseFragment,serialize} from 'parse5';
export function previewHtml(source,notice,localConfig){
 const document=parse(source);
 const html=document.childNodes.find(node=>node.nodeName==='html');
 html.attrs=html.attrs.filter(attr=>attr.name!=='data-af-private-preview');
 html.attrs.push({name:'data-af-private-preview',value:'true'});
 if(localConfig){
  let previous={};
  function removeRuntime(node){if(!node.childNodes)return;node.childNodes=node.childNodes.filter(child=>{if(child.nodeName==='script'&&child.attrs?.some(attr=>attr.name==='data-af'&&attr.value==='runtime')){try{previous=JSON.parse(child.childNodes?.map(part=>part.value??'').join('')||'{}');}catch{}return false;}removeRuntime(child);return true;});}
  removeRuntime(html);
  const config={...previous,...localConfig};delete config.appOrigin;
  const block=parseFragment('<script type="application/json" data-af="runtime">'+JSON.stringify(config).replace(/</g,'\\u003c')+'</script>').childNodes[0];
  const head=html.childNodes.find(node=>node.nodeName==='head');block.parentNode=head;head.childNodes.unshift(block);
 }
 const body=html.childNodes.find(node=>node.nodeName==='body');
 for(const node of parseFragment(notice).childNodes){node.parentNode=body;body.childNodes.push(node);}
 return serialize(document);
}

/** Return authored declarations only; the server resolves local paths under its root. */
export function previewDatasetLinks(source){
 const document=parse(source),links=[];let baseHref;
 function visit(node){
  const attrs=Object.fromEntries((node.attrs??[]).map(({name,value})=>[name,value]));
  if(node.nodeName==='base'&&baseHref===undefined)baseHref=attrs.href;
  if(node.nodeName==='link'&&(attrs.rel??'').split(/\s+/).includes('af-dataset')&&attrs['data-af-name'])links.push({name:attrs['data-af-name'],href:attrs.href??'',table:attrs['data-af-table'],schema:attrs['data-af-schema']});
  for(const child of node.childNodes??[])visit(child);
 }visit(document);return {links,baseHref};
}
