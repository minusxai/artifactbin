/** Website layouts retain their actual tags and direct-child CSS relationships. */
import type {Node as PmNode} from 'prosemirror-model';
import type {NodeView} from 'prosemirror-view';
import {canvasAttributes,canvasTag} from './canvas-dom';

export function canvasNodeView(node:PmNode):NodeView{
 const tag=node.attrs.name==='Helmet'?'span':canvasTag(node.attrs.tag??'div');
 const dom=document.createElement(tag);let current=node;
 function draw(){
  for(const attribute of [...dom.attributes])if(!['style','data-node-id','data-mdx-canvas-node'].includes(attribute.name))dom.removeAttribute(attribute.name);
  for(const [key,value] of Object.entries(canvasAttributes(current.attrs.props)))dom.setAttribute(key,value);
  dom.dataset.nodeId=current.attrs.id;dom.dataset.mdxCanvasNode='';
  if(current.attrs.name==='Helmet'){dom.hidden=true;dom.contentEditable='false';return;}
  const props=current.attrs.props;
  for(const key of ['width','height'] as const){if(typeof props[key]==='number')dom.style.setProperty(key,`${props[key]}px`,'important');else dom.style.removeProperty(key);}
  dom.style.cssFloat=['left','right'].includes(props.float)?props.float:'';
 }
 draw();
 return {dom,...(!node.isAtom||node.type.name==='container'?{contentDOM:dom}:{}),update(next){if(next.type!==current.type||next.attrs.tag!==current.attrs.tag)return false;const selected=dom.classList.contains('ProseMirror-selectednode');current=next;draw();if(selected)dom.classList.add('ProseMirror-selectednode');return true;},ignoreMutation:mutation=>mutation.type==='attributes'&&mutation.target===dom};
}
