/** One sizing boundary for toolbar fields and canvas handles. Flex owns child shares. */
import {NodeSelection} from 'prosemirror-state';
import type {EditorView} from 'prosemirror-view';
import type {DocumentJson} from '@artifactbin/contracts';
import {flexRatios,setFlexChildShare,widthPercentage} from '../story-ui/flex-layout';

export function nodeParentExtent(view:EditorView,pos:number,axis:'width'|'height'='width'):number {
 const dom=view.nodeDOM(pos) as HTMLElement|null,parent=dom?.parentElement;if(!parent)return 0;
 const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();
 return axis==='width'?rect.width-parseFloat(style.paddingLeft||'0')-parseFloat(style.paddingRight||'0'):rect.height-parseFloat(style.paddingTop||'0')-parseFloat(style.paddingBottom||'0');
}
function parentFlex(view:EditorView,pos:number){const resolved=view.state.doc.resolve(pos),parent=resolved.parent;return parent.attrs.name==='Flex'?{node:parent,pos:resolved.before(),index:resolved.index()}:null;}
export function nodeWidthPercentage(view:EditorView,pos:number):number {
 const flex=parentFlex(view,pos);if(flex&&flex.node.attrs.props.direction!=='column'){const sizes=flexRatios(flex.node.attrs.props.sizes,flex.node.childCount);return widthPercentage(sizes[flex.index],sizes.reduce((a,b)=>a+b,0));}
 const dom=view.nodeDOM(pos) as HTMLElement|null;return widthPercentage(dom?.getBoundingClientRect().width??0,nodeParentExtent(view,pos));
}
export function setNodeWidthPercentage(view:EditorView,pos:number,percentage:number):void {
 const flex=parentFlex(view,pos);
 if(flex&&flex.node.attrs.props.direction!=='column'){
  const sizes=setFlexChildShare(flexRatios(flex.node.attrs.props.sizes,flex.node.childCount),flex.index,percentage);
  const tr=view.state.tr.setNodeMarkup(flex.pos,undefined,{...flex.node.attrs,props:{...flex.node.attrs.props,sizes}});tr.setSelection(NodeSelection.create(tr.doc,pos));view.dispatch(tr);
 }else setDocumentNodeProps(view,pos,{width:Math.round(nodeParentExtent(view,pos)*percentage/100)});
}
export function setDocumentNodeProps(view:EditorView,pos:number,patch:Record<string,DocumentJson>):void {
 const node=view.state.doc.nodeAt(pos);if(!node)return;const flex=parentFlex(view,pos),props={...node.attrs.props,...patch};let tr=view.state.tr;
 const axis=flex?.node.attrs.props.direction==='column'?'height':'width';
 if(flex&&typeof patch[axis]==='number'){
  const available=nodeParentExtent(view,pos,axis);
  if(available>0){const sizes=setFlexChildShare(flexRatios(flex.node.attrs.props.sizes,flex.node.childCount),flex.index,widthPercentage(patch[axis],available));tr=tr.setNodeMarkup(flex.pos,undefined,{...flex.node.attrs,props:{...flex.node.attrs.props,sizes}});delete props[axis];}
 }
 tr=tr.setNodeMarkup(pos,undefined,{...node.attrs,props});
 if(view.state.selection instanceof NodeSelection)tr.setSelection(NodeSelection.create(tr.doc,pos));view.dispatch(tr);
}
/** Preview changes node-view-owned sizing only; editable child nodes stay untouched. */
export function dimensionPreview(view:EditorView,pos:number,dom:HTMLElement){
 const originalWidth=dom.style.width,originalHeight=dom.style.minHeight,flex=parentFlex(view,pos);
 const content=dom.querySelector<HTMLElement>(':scope > .mdx-container-content'),originalContentHeight=content?.style.minHeight;
 const sheet=document.createElement('style');document.head.append(sheet);
 return {
  update(width:number,height:number){
   dom.style.width=`${width}px`;dom.style.minHeight=`${height}px`;if(content)content.style.minHeight=`${height}px`;
   if(flex){const axis=flex.node.attrs.props.direction==='column'?'height':'width',extent=nodeParentExtent(view,pos,axis),sizes=setFlexChildShare(flexRatios(flex.node.attrs.props.sizes,flex.node.childCount),flex.index,widthPercentage(axis==='width'?width:height,extent));sheet.textContent=sizes.map((size,i)=>`.mdx-container[data-node-id="${flex.node.attrs.id}"] > .mdx-container-content > :nth-child(${i+1}){flex:${size} 1 0!important}`).join('');}
  },
  clear(){sheet.remove();dom.style.width=originalWidth;dom.style.minHeight=originalHeight;if(content)content.style.minHeight=originalContentHeight??'';},
 };
}
