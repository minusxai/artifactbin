import {render,encode,decode} from './renderer.mjs';
const version='markdown-it@14.3.3/commonmark-no-html-no-images/v1';
/** @param {import("./contracts.js").ComponentRegistration} options
 * @returns {import("./contracts.js").ComponentConstructor} */
export function register({sourceCaptured}){
 const existing=/** @type {import('./contracts.js').ComponentConstructor | undefined} */ (customElements.get('af-markdown'));
 if(existing){if(existing.rendererVersion!==version)throw new Error('Conflicting markdown renderer');return existing;}
 /** @typedef {import("./contracts.js").MarkdownElement} MarkdownElementContract */
 /** @implements {MarkdownElementContract} */
 class MarkdownElement extends HTMLElement{
  canRender=false;
  static rendererVersion=version;
  connectedCallback(){sourceCaptured.then(()=>{this.canRender=true;this.draw()}).catch(()=>{this.dataset.afError='source-capture-failed'})}
  /** @param {string} source */
  setSource(source){
   const json=encode(source);let node=this.querySelector(/** @type {'script'} */ (':scope > [data-af-source]'));
   if(!node){node=document.createElement('script');node.type='application/json';node.dataset.afSource='';this.prepend(node)}
   node.textContent=json;this.draw();
  }
  draw(){
   if(!this.canRender||!this.isConnected)return;
   const node=this.querySelector(':scope > script[type="application/json"][data-af-source]');
   if(!node)return; // Await explicit source commit for asynchronously assembled instances.
   let html;try{html=render(decode(node.textContent??''))}catch{this.dataset.afError='invalid-source';return}
   let output=this.querySelector(/** @type {'div'} */ (':scope > [data-af-output]'));
   if(!output){output=document.createElement('div');output.dataset.afOutput='';this.append(output)}
   output.innerHTML=html;delete this.dataset.afError;this.dispatchEvent(new Event('af-ready',{bubbles:true}));
  }
 }
 customElements.define('af-markdown',MarkdownElement);return MarkdownElement;
}
