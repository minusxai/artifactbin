import"./chunk-oojm4ctu.js";var r=class extends HTMLElement{static observedAttributes=["type","disabled","busy","variant","size","label","aria-label","name","value"];nativeButton;get type(){return this.getAttribute("type")==="submit"||this.getAttribute("type")==="reset"?this.getAttribute("type"):"button"}set type(t){this.setAttribute("type",t)}get disabled(){return this.hasAttribute("disabled")}set disabled(t){this.toggleAttribute("disabled",!!t)}get busy(){return this.hasAttribute("busy")}set busy(t){this.toggleAttribute("busy",!!t)}get variant(){return o(this.getAttribute("variant"))?this.getAttribute("variant"):"default"}set variant(t){this.setAttribute("variant",t)}get size(){return s(this.getAttribute("size"))?this.getAttribute("size"):"default"}set size(t){this.setAttribute("size",t)}get label(){return this.getAttribute("label")??void 0}set label(t){t===void 0?this.removeAttribute("label"):this.setAttribute("label",t)}connectedCallback(){let t=this;for(let a of["type","disabled","busy","variant","size","label"])if(Object.prototype.hasOwnProperty.call(this,a)){let n=t[a];delete t[a],t[a]=n}if(!this.nativeButton){let a=this.ownerDocument.createElement("button");a.setAttribute("part","button"),a.append(...Array.from(this.childNodes)),this.append(a),this.nativeButton=a}this.sync()}attributeChangedCallback(){this.sync()}focus(t){(this.nativeButton??this.querySelector("button"))?.focus(t)}click(){let t=this.nativeButton??this.querySelector("button");!t||this.disabled||this.busy||t.click()}sync(){let t=this.nativeButton;if(!t)return;t.type=this.type,t.disabled=this.disabled||this.busy,t.toggleAttribute("aria-busy",this.busy),this.busy&&t.setAttribute("aria-busy","true"),t.dataset.variant=this.variant,t.dataset.size=this.size;let a=this.getAttribute("aria-label")??this.getAttribute("label");a===null?t.removeAttribute("aria-label"):t.setAttribute("aria-label",a);for(let n of["name","value"]){let i=this.getAttribute(n);i===null?t.removeAttribute(n):t.setAttribute(n,i)}}};function o(e){return e==="default"||e==="destructive"||e==="outline"||e==="secondary"||e==="ghost"||e==="link"}function s(e){return e==="default"||e==="xs"||e==="sm"||e==="lg"||e==="icon"||e==="icon-xs"||e==="icon-sm"||e==="icon-lg"}var u=`
af-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle}
af-button>button{box-sizing:border-box;display:inline-flex;flex-shrink:0;align-items:center;justify-content:center;gap:.5rem;border:0 solid transparent;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));font-family:inherit;font-size:.875rem;font-weight:500;line-height:1.25rem;white-space:nowrap;cursor:pointer;transition:all .15s;outline:none;color:var(--primary-foreground,#fff);background:var(--primary,#171717)}
af-button>button:focus-visible{border-color:var(--ring,#737373);box-shadow:0 0 0 3px color-mix(in srgb,var(--ring,#737373) 50%,transparent)}
af-button>button:disabled{pointer-events:none;opacity:.5;cursor:default}
af-button>button[data-variant=default]:hover{background:color-mix(in srgb,var(--primary,#171717) 90%,transparent)}
af-button>button[data-variant=destructive]{color:#fff;background:var(--destructive,#dc2626)}
af-button>button[data-variant=destructive]:hover{background:color-mix(in srgb,var(--destructive,#dc2626) 90%,transparent)}
af-button>button[data-variant=outline]{color:var(--foreground,#171717);background:var(--background,#fff);border:1px solid currentColor;box-shadow:0 1px 2px rgb(0 0 0 / .05)}
af-button>button[data-variant=outline]:hover{background:var(--accent,#f5f5f5);color:var(--accent-foreground,#171717)}
af-button>button[data-variant=secondary]{background:var(--secondary,#f5f5f5);color:var(--secondary-foreground,#262626)}
af-button>button[data-variant=secondary]:hover{background:color-mix(in srgb,var(--secondary,#f5f5f5) 80%,transparent)}
af-button>button[data-variant=ghost]{color:var(--foreground,#171717);background:transparent}
af-button>button[data-variant=ghost]:hover{background:var(--accent,#f5f5f5);color:var(--accent-foreground,#171717)}
af-button>button[data-variant=link]{color:var(--primary,#171717);background:transparent;text-underline-offset:4px}
af-button>button[data-variant=link]:hover{text-decoration:underline}
af-button>button[data-size=default]{height:2.25rem;padding:.5rem 1rem}
af-button>button[data-size=xs]{height:1.5rem;gap:.25rem;padding:0 .5rem;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));font-size:.75rem;line-height:1rem}
af-button>button[data-size=sm]{height:2rem;gap:.375rem;padding:0 .75rem}
af-button>button[data-size=lg]{height:2.5rem;padding:0 1.5rem}
af-button>button[data-size=icon]{width:2.25rem;height:2.25rem;padding:0}
af-button>button[data-size=icon-xs]{width:1.5rem;height:1.5rem;padding:0;border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px))}
af-button>button[data-size=icon-sm]{width:2rem;height:2rem;padding:0}
af-button>button[data-size=icon-lg]{width:2.5rem;height:2.5rem;padding:0}
af-button>button[data-size=default]:has(>svg){padding-inline:.75rem}
af-button>button[data-size=xs]:has(>svg){padding-inline:.375rem}
af-button>button[data-size=sm]:has(>svg){padding-inline:.625rem}
af-button>button[data-size=lg]:has(>svg){padding-inline:1rem}
af-button>button>svg{pointer-events:none;flex-shrink:0;width:1rem;height:1rem}
af-button>button[data-size=xs]>svg,af-button>button[data-size=icon-xs]>svg{width:.75rem;height:.75rem}
html[data-af-dark="true"] af-button>button[data-variant=outline]{border-color:var(--input,#d4d4d4);background:color-mix(in srgb,var(--input,#d4d4d4) 30%,transparent)}
html[data-af-dark="true"] af-button>button[data-variant=outline]:hover{background:color-mix(in srgb,var(--input,#d4d4d4) 50%,transparent)}
html[data-af-dark="true"] af-button>button[data-variant=ghost]:hover{background:color-mix(in srgb,var(--accent,#f5f5f5) 50%,transparent)}
html[data-af-dark="true"] af-button>button[data-variant=destructive]{background:color-mix(in srgb,var(--destructive,#dc2626) 60%,transparent)}
html[data-af-dark="true"] af-button>button:focus-visible{box-shadow:0 0 0 3px color-mix(in srgb,var(--ring,#737373) 40%,transparent)}
 `;function d(e=customElements,t=globalThis.document){if(!t.querySelector("style[data-af-button-styles]")){let a=t.createElement("style");a.setAttribute("data-af-button-styles",""),a.textContent=u,t.head.append(a)}e.get("af-button")||e.define("af-button",r)}export{r as AfButton,d as registerButton};
