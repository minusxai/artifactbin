import{a as n,b as l,c as i}from"./chunk-zyei7b7f.js";import"./chunk-oojm4ctu.js";var r=class extends HTMLElement{static observedAttributes=[...n];controller;propertyControlled=!1;propertyValue;get value(){return i(this,this.propertyControlled,this.propertyValue)}set value(t){this.propertyControlled=t!==void 0,this.propertyValue=t,this.controller?.sync()}connectedCallback(){if(Object.prototype.hasOwnProperty.call(this,"value")){let t=this.value;delete this.value,this.value=t}this.controller?.disconnect(),this.controller=l(this,"input",{controlled:()=>this.propertyControlled,value:()=>this.propertyValue})}disconnectedCallback(){this.controller?.disconnect(),this.controller=void 0}attributeChangedCallback(){this.refresh()}refresh(){this.isConnected&&this.controller?.sync()}},a=`
af-input{display:inline-flex;min-width:12rem;flex-direction:column;gap:.375rem;vertical-align:top}
af-input>label[data-af-control-label]{font-family:inherit;font-size:11px;font-weight:500;line-height:1.4;letter-spacing:.05em;text-transform:uppercase;color:var(--muted-foreground,#666)}
af-input>label[hidden]{display:none}
af-input>label.af-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
af-input>.af-text-control{box-sizing:border-box;width:100%;min-width:12rem;height:36px;border:1px solid var(--input,#d1d5db);border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));background:var(--background,#fff);padding:0 12px;color:var(--foreground,#111);font-family:inherit;font-size:14px;line-height:20px;box-shadow:0 1px 2px #0000000d;outline:none;transition:color .15s,box-shadow .15s}
af-input>.af-text-control::placeholder{color:var(--muted-foreground,#737373)}
af-input>.af-text-control:focus-visible{box-shadow:0 0 0 2px color-mix(in srgb,var(--ring,#777) 50%,transparent)}
af-input>.af-text-control:disabled{cursor:not-allowed;opacity:.5}
af-input>.af-text-control:read-only{cursor:default}
af-input>.af-text-control[type=number]{font-variant-numeric:tabular-nums}
`;function d(e=customElements,t=globalThis.document){if(!t.querySelector("style[data-af-input-styles]")){let o=t.createElement("style");o.dataset.afInputStyles="",o.textContent=a,t.head.append(o)}e.get("af-input")||e.define("af-input",r)}export{d as registerInput};
