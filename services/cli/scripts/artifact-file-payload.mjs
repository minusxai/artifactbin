/** Inspect the HTML carrier as data, ignoring instructional comments and executable scripts. */
import {parse} from 'parse5';
export function artifactFilePayload(html){
 const carriers=[];
 function visit(node){
  if(node.tagName==='script'&&node.attrs?.some(attr=>attr.name==='id'&&attr.value==='afbin-file')){
   if(!node.attrs.some(attr=>attr.name==='type'&&attr.value==='application/json'))throw new Error('Invalid artifact file JSON carrier.');
   carriers.push(node.childNodes.map(child=>child.value??'').join(''));
  }
  for(const child of node.childNodes??[])visit(child);
 }
 visit(parse(html));
 if(carriers.length!==1)throw new Error('Expected exactly one artifact file JSON carrier.');
 return JSON.parse(carriers[0]);
}
