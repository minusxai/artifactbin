/** An intentionally small semantic projection, not a general HTML sanitizer. */
const allowed=new Set('article section main header footer nav aside h1 h2 h3 h4 h5 h6 p div span pre code blockquote ul ol li dl dt dd table caption thead tbody tfoot tr th td strong em b i u s small sub sup br hr figure figcaption details summary'.split(' '));
const dropped=new Set('script style link meta base iframe frame frameset object embed applet template svg math noscript canvas audio video source track'.split(' '));
export function assembleStaticReplay(source:string):string {
  // A detached template is inert, including custom elements and resource loads.
  const input=document.createElement('template');input.innerHTML=source;
  const output=document.createElement('div');
  function append(node:Node,parent:Node):void {
    if(node.nodeType===Node.TEXT_NODE){parent.appendChild(document.createTextNode(node.textContent??''));return}
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    const element=node as Element, tag=element.localName;
    if(element.namespaceURI!=='http://www.w3.org/1999/xhtml'||dropped.has(tag))return;
    if(tag==='img'){parent.appendChild(document.createTextNode(element.getAttribute('alt')??'[image omitted]'));return}
    // Unknown elements, custom elements, links and controls lose identity/behavior;
    // text children survive. No attributes are copied except stable annotation IDs.
    const next=allowed.has(tag)?document.createElement(tag):document.createElement('span');
    const identity=element.getAttribute('data-pagegi-id');
    if(identity)next.setAttribute('data-pagegi-id',identity);
    parent.appendChild(next);
    for(const child of element.childNodes)append(child,next);
  }
  for(const node of input.content.childNodes)append(node,output);
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'none\'; connect-src \'none\'; img-src \'none\'; font-src \'none\'; media-src \'none\'; object-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'"><title>Static saved view</title></head><body>'+output.innerHTML+'</body></html>';
}
/** The adapter owns sandbox policy; callers never choose allowances. */
export function mountStaticReplay(parent:HTMLElement,html:string):HTMLIFrameElement {
  const frame=document.createElement('iframe');
  frame.title='Static saved view';frame.setAttribute('sandbox','');frame.srcdoc=html;parent.append(frame);return frame;
}
