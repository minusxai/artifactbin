/** A bounded, inert copy avoids Chromium capturing an ancestor's zoomed paint layer. */
export function dragPreview(source:HTMLElement){
 const owner=source.ownerDocument,win=owner.defaultView!;
 const clone=source.cloneNode(true) as HTMLElement;
 const originals=[source,...source.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
 originals.forEach((original,index)=>{
  const copy=copies[index];if(!(copy instanceof HTMLElement)&&!(copy instanceof SVGElement))return;
  const computed=win.getComputedStyle(original);
  for(let i=0;i<computed.length;i++){const key=computed.item(i);copy.style.setProperty(key,computed.getPropertyValue(key));}
  for(const attribute of [...copy.attributes])if(['id','class','contenteditable','draggable'].includes(attribute.name)||attribute.name.startsWith('data-')||attribute.name.startsWith('on'))copy.removeAttribute(attribute.name);
  copy.style.setProperty('animation','none');copy.style.setProperty('transition','none');copy.style.setProperty('outline','none');
  if(original.matches('button,style,script,iframe,.mdx-container-controls,.mdx-component-controls'))copy.style.display='none';
 });
 let background='transparent';for(let ancestor:HTMLElement|null=source;ancestor;ancestor=ancestor.parentElement){const color=win.getComputedStyle(ancestor).backgroundColor;if(color&&color!=='transparent'&&color!=='rgba(0, 0, 0, 0)'){background=color;break;}}
 const rect=source.getBoundingClientRect(),width=Math.max(1,source.offsetWidth||rect.width),height=Math.max(1,source.offsetHeight||rect.height),scale=Math.min(1,360/width,240/height);
 Object.assign(clone.style,{position:'relative',left:'0',top:'0',margin:'0',width:`${width}px`,height:`${height}px`,minWidth:'0',minHeight:'0',maxWidth:'none',maxHeight:'none',zoom:'1',transform:`scale(${scale})`,transformOrigin:'top left'});
 const host=owner.createElement('div');host.dataset.mdxDragPreview='';host.setAttribute('aria-hidden','true');host.inert=true;
 Object.assign(host.style,{position:'fixed',left:'0',top:'0',width:`${Math.ceil(width*scale)}px`,height:`${Math.ceil(height*scale)}px`,overflow:'hidden',pointerEvents:'none',zIndex:'-1',contain:'strict',isolation:'isolate',background});
 host.append(clone);owner.body.append(host);return host;
}
