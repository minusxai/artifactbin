function p(t,e,o){return Object.assign(t,{fields:e||[],fname:o})}function Pt(t){return t==null?null:t.fname}function z(t){return t==null?null:t.fields}function L(t){return t.length===1?zt(t[0]):Rt(t)}var zt=t=>function(e){return e[t]},Rt=t=>{let e=t.length;return function(o){for(let n=0;n<e;++n)o=o[t[n]];return o}};function x(t){throw Error(t)}function E(t){let e=[],o=t.length,n=null,r=0,i="",s,l,a;t=t+"";function u(){e.push(i+t.substring(s,l)),i="",s=l+1}for(s=l=0;l<o;++l)if(a=t[l],a==="\\")i+=t.substring(s,l++),s=l;else if(a===n)u(),n=null,r=-1;else{if(n)continue;s===r&&a==='"'||s===r&&a==="'"?(s=l+1,n=a):a==="."&&!r?l>s?u():s=l+1:a==="["?(l>s&&u(),r=s=l+1):a==="]"&&(r||x("Access path missing open bracket: "+t),r>0&&u(),r=0,s=l+1)}return r&&x("Access path missing closing bracket: "+t),n&&x("Access path missing closing quote: "+t),l>s&&(l++,u()),e}function D(t,e,o){let n=E(t),r=n.length===1?n[0]:t;return p((o&&o.get||L)(n),[r],e||r)}var Ht=D("id"),$t=p(t=>t,[],"identity"),Vt=p(()=>0,[],"zero"),Ut=p(()=>1,[],"one"),Bt=p(()=>!0,[],"true"),Wt=p(()=>!1,[],"false");var qt=new Set([...Object.getOwnPropertyNames(Object.prototype).filter(t=>typeof Object.prototype[t]=="function"),"__proto__","then"]);function Xt(t,e,o){let n=[e,...o];console[t](...n)}var B=0,W=1,q=2,X=3,Y=4;function Yt(t,e,o=Xt){let n=t||B;return{level(r){return arguments.length?(n=+r,this):n},error(...r){return n>=W&&o(e||"error","ERROR",r),this},warn(...r){return n>=q&&o(e||"warn","WARN",r),this},info(...r){return n>=X&&o(e||"log","INFO",r),this},debug(...r){return n>=Y&&o(e||"log","DEBUG",r),this}}}var b=Array.isArray;function h(t){return t===Object(t)}var G=t=>t!=="__proto__"&&t!=="constructor"&&t!=="prototype";function Gt(...t){return t.reduce((e,o)=>{for(let n in o)if(n==="signals")e.signals=Jt(e.signals,o.signals);else{let r=n==="legend"?{layout:1}:n==="style"?!0:null;R(e,n,o[n],r)}return e},{})}function R(t,e,o,n){if(!G(e))return;let r=t,i,s;if(h(o)&&!b(o)){let l=o;s=h(r[e])?r[e]:r[e]={};for(i in l)n&&(n===!0||n[i])?R(s,i,l[i]):G(i)&&(s[i]=l[i])}else r[e]=o}function Jt(t,e){if(t==null)return e;if(e==null)return t;let o={},n=[];function r(i){o[i.name]||(o[i.name]=1,n.push(i))}return e.forEach(r),t.forEach(r),n}function d(t){return t[t.length-1]}function A(t){return t==null||t===""?null:+t}function J(t){return t.length>0}var K=t=>e=>t*Math.exp(e),_=t=>e=>Math.log(t*e),Z=t=>e=>Math.sign(e)*Math.log1p(Math.abs(e/t)),Q=t=>e=>Math.sign(e)*Math.expm1(Math.abs(e))*t,M=t=>e=>e<0?-Math.pow(-e,t):Math.pow(e,t),tt=t=>A(t)??0,et=t=>t;function S(t,e,o,n){J(t)||x("Domain array must not be empty");let r=o(t[0]),i=o(d(t)),s=(i-r)*e;return[n(r-s),n(i-s)]}function Kt(t,e){return S(t,e,tt,et)}function _t(t,e){let o=Math.sign(t[0]);return S(t,e,_(o),K(o))}function Zt(t,e,o){return S(t,e,M(o),M(1/o))}function Qt(t,e,o){return S(t,e,Z(o),Q(o))}function k(t,e,o,n,r){J(t)||x("Domain array must not be empty");let i=n(t[0]),s=n(d(t)),l=e!=null?n(e):(i+s)/2;return[r(l+(i-l)*o),r(l+(s-l)*o)]}function te(t,e,o){return k(t,e,o,tt,et)}function ee(t,e,o){let n=Math.sign(t[0]);return k(t,e,o,_(n),K(n))}function oe(t,e,o,n){return k(t,e,o,M(n),M(1/n))}function ne(t,e,o,n){return k(t,e,o,Z(n),Q(n))}function re(t){return 1+~~(new Date(t).getMonth()/3)}function ie(t){return 1+~~(new Date(t).getUTCMonth()/3)}function w(t){return t!=null?b(t)?t:[t]:[]}function ot(t,e,o){let n=t[0],r=t[1],i;return r<n&&(i=r,r=n,n=i),i=r-n,i>=o-e?[e,o]:[n=Math.min(Math.max(n,e),o-i),n+i]}function y(t){return typeof t=="function"}var se="descending";function nt(t,e,o){let n=o||{},r=w(e)||[],i=[],s=[],l={},a=n.comparator||le;return w(t).forEach((u,f)=>{if(u==null)return;i.push(r[f]===se?-1:1);let m=y(u)?u:D(u,void 0,n);s.push(m),(z(m)||[]).forEach(T=>l[T]=1)}),s.length===0?null:p(a(s,i),Object.keys(l))}var H=(t,e)=>{let o=t,n=e;return(o<n||o==null)&&n!=null?-1:(o>n||n==null)&&o!=null?1:(n=n instanceof Date?+n:n,(o=o instanceof Date?+o:o)!==o&&n===n?-1:n!==n&&o===o?1:0)},le=(t,e)=>t.length===1?ae(t[0],e[0]):ue(t,e,t.length),ae=(t,e)=>function(o,n){return H(t(o),t(n))*e},ue=(t,e,o)=>(e.push(0),function(n,r){let i,s=0,l=-1;for(;s===0&&++l<o;)i=t[l],s=H(i(n),i(r));return s*e[l]});function fe(t){return y(t)?t:()=>t}function rt(t,e){let o=null;return n=>{o&&clearTimeout(o),o=setTimeout(()=>(e(n),o=null),t)}}function C(t,...e){for(let o of e)for(let n in o)t[n]=o[n];return t}function it(t,e){let o=0,n,r,i,s;if(t&&(n=t.length))if(e==null){for(r=t[o];o<n&&(r==null||r!==r);r=t[++o]);for(i=s=r;o<n;++o)r=t[o],r!=null&&(r<i&&(i=r),r>s&&(s=r))}else{for(r=e(t[o]);o<n&&(r==null||r!==r);r=e(t[++o]));for(i=s=r;o<n;++o)r=e(t[o]),r!=null&&(r<i&&(i=r),r>s&&(s=r))}return[i,s]}function st(t,e){let o=t.length,n=-1,r,i,s,l,a;if(e==null){for(;++n<o;)if(l=t[n],l!=null&&l>=l){s=a=l;break}if(n===o)return[-1,-1];for(r=i=n;++n<o;)l=t[n],l!=null&&(s>l&&(s=l,r=n),a<l&&(a=l,i=n))}else{for(;++n<o;)if(l=e(t[n],n,t),l!=null&&l>=l){s=a=l;break}if(n===o)return[-1,-1];for(r=i=n;++n<o;)l=e(t[n],n,t),l!=null&&(s>l&&(s=l,r=n),a<l&&(a=l,i=n))}return[r,i]}function g(t,e){return Object.hasOwn(t,e)}var F={};function lt(t){let e={},o;function n(i){return g(e,i)&&e[i]!==F}let r={size:0,empty:0,object:e,has:n,get(i){return n(i)?e[i]:void 0},set(i,s){return n(i)||(++r.size,e[i]===F&&--r.empty),e[i]=s,this},delete(i){return n(i)&&(--r.size,++r.empty,e[i]=F),this},clear(){r.size=r.empty=0,r.object=e={}},test(i){return arguments.length?(o=i,r):o},clean(){let i={},s=0;for(let l in e){let a=e[l];a!==F&&(!o||!o(a))&&(i[l]=a,++s)}r.size=s,r.empty=0,r.object=e=i}};return t&&Object.keys(t).forEach(i=>{r.set(i,t[i])}),r}function ce(t,e,o,n,r,i){if(!o&&o!==0)return i;let s=+o,l=t[0],a=d(t),u;if(a===void 0)return i;a<l&&(u=l,l=a,a=u),u=Math.abs(e-l);let f=Math.abs(a-e);return u<f&&u<=s?n:f<=s?r:i}function pe(t,e,o){let n=t.prototype=Object.create(e.prototype);return Object.defineProperty(n,"constructor",{value:t,writable:!0,enumerable:!0,configurable:!0}),C(n,o)}function at(t,e,o,n){let r=e[0],i=e[e.length-1],s;return r>i&&(s=r,r=i,i=s),o=o===void 0||o,n=n===void 0||n,(o?r<=t:r<t)&&(n?t<=i:t<i)}function ut(t){return typeof t=="boolean"}function I(t){return Object.prototype.toString.call(t)==="[object Date]"}function ft(t){return t!=null&&y(t[Symbol.iterator])}function N(t){return typeof t=="number"}function ct(t){return Object.prototype.toString.call(t)==="[object RegExp]"}function O(t){return typeof t=="string"}function pt(t,e,o){let n=t?e?w(t).map(a=>a.replace(/\\(.)/g,"$1")):w(t):void 0,r=n?.length,i=o&&o.get||L,s=a=>i(e?[a]:E(a)),l;if(!r||!n)l=function(){return""};else if(r===1){let a=s(n[0]);l=function(u){return""+a(u)}}else{let a=n.map(s);l=function(u){let f=""+a[0](u),m=0;for(;++m<r;)f+="|"+a[m](u);return f}}return p(l,n,"key")}function de(t,e){let o=t[0],n=d(t),r=+e;return n===void 0?o:r?r===1?n:o+r*(n-o):o}var me=1e4;function he(t){t=+t||me;let e,o,n,r=()=>{e={},o={},n=0},i=(s,l)=>(++n>t&&(o=e,e={},n=1),e[s]=l);return r(),{clear:r,has:s=>g(e,s)||g(o,s),get:s=>g(e,s)?e[s]:g(o,s)?i(s,o[s]):void 0,set:(s,l)=>g(e,s)?e[s]=l:i(s,l)}}function ge(t){return t===Array||typeof t=="function"&&t.prototype&&ArrayBuffer.isView(t.prototype)}function dt(t,e,o,n){let r=e.length,i=o.length;if(!i)return e;if(!r)return o;let s=e.constructor,l=n||(ge(s)?new s(r+i):new Array(r+i)),a=0,u=0,f=0;for(;a<r&&u<i;++f)l[f]=t(e[a],o[u])>0?o[u++]:e[a++];for(;a<r;++a,++f)l[f]=e[a];for(;u<i;++u,++f)l[f]=o[u];return l}function v(t,e){let o="";for(;--e>=0;)o+=t;return o}function mt(t,e,o,n){let r=o||" ",i=t+"",s=e-i.length;return s<=0?i:n==="left"?v(r,s)+i:n==="center"?v(r,~~(s/2))+i+v(r,Math.ceil(s/2)):i+v(r,s)}function xe(t){return t&&d(t)-t[0]||0}function $(t){return b(t)?`[${t.map(e=>e===null?"null":$(e))}]`:h(t)||O(t)?JSON.stringify(t).replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029"):t}function ht(t){return t==null||t===""?null:!t||t==="false"||t==="0"?!1:!!t}var be=t=>N(t)||I(t)?t:Date.parse(t);function gt(t,e){return e=e||be,t==null||t===""?null:e(t)}function xt(t){return t==null||t===""?null:t+""}function bt(t){let e={},o=t.length;for(let n=0;n<o;++n)e[t[n]+""]=!0;return e}function yt(t,e,o,n){let r=n??"\u2026",i=t+"",s=i.length,l=Math.max(0,e-r.length);return s<=e?i:o==="left"?r+i.slice(s-l):o==="center"?i.slice(0,Math.ceil(l/2))+r+i.slice(s-~~(l/2)):i.slice(0,l)+r}function wt(t,e,o){if(t)if(e){let n=t.length;for(let r=0;r<n;++r){let i=e(t[r]);i&&o(i,r,t)}}else t.forEach(o)}var ye="1.0.0",we={version:ye};function Et(t,e,o,n){if(b(t))return`[${t.map(r=>e(O(r)?r:vt(r,o))).join(", ")}]`;if(h(t)){let r="",{title:i,image:s,...l}=t;i&&(r+=`<h2>${e(i)}</h2>`),s&&(r+=`<img src="${new URL(e(s),n||location.href).href}">`);let a=Object.keys(l);if(a.length>0){r+="<table>";for(let u of a){let f=l[u];f!==void 0&&(h(f)&&(f=vt(f,o)),r+=`<tr><td class="key">${e(u)}</td><td class="value">${e(f)}</td></tr>`)}r+="</table>"}return r||"{}"}return e(t)}function ve(t){let e=[];return function(o,n){if(typeof n!="object"||n===null)return n;let r=e.indexOf(this)+1;return e.length=r,e.length>t?"[Object]":e.indexOf(n)>=0?"[Circular]":(e.push(n),n)}}function vt(t,e){return JSON.stringify(t,ve(e))}function Dt(t){return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;")}var or=we.version;var Ot="mx-viz-tooltip-styles",Ee=`
#vg-tooltip-element,
#mx-shared-tooltip {
  z-index: 100002 !important;
  font-family: var(--font-jetbrains-mono, 'JetBrains Mono', monospace);
  font-size: 11px;
  line-height: 1.6;
  border: none !important;
  border-radius: 9px;
  padding: 9px 12px;
  color: inherit;
}
#vg-tooltip-element.dark-theme,
#mx-shared-tooltip.dark-theme {
  background: rgba(22, 27, 34, 0.96);
  color: #e6edf3;
  box-shadow: 0 8px 28px -8px rgba(0, 0, 0, 0.65), inset 0 0 0 0.5px rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(3px);
}
#vg-tooltip-element:not(.dark-theme),
#mx-shared-tooltip:not(.dark-theme) {
  background: rgba(255, 255, 255, 0.98);
  color: #1f2328;
  box-shadow: 0 8px 28px -8px rgba(20, 27, 45, 0.22), inset 0 0 0 0.5px rgba(20, 27, 45, 0.08);
  backdrop-filter: blur(3px);
}
#vg-tooltip-element table { border-collapse: collapse; }
#vg-tooltip-element table tr td { padding-top: 1px; padding-bottom: 1px; }
#vg-tooltip-element table tr td.key {
  opacity: 0.55;
  max-width: 150px;
  padding-right: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: text-top;
  font-weight: 500;
  text-align: right;
}
#vg-tooltip-element table tr td.value {
  display: block;
  max-width: 300px;
  max-height: 7em;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  text-align: left;
}
#mx-shared-tooltip { min-width: 132px; }

/*
 * The close button a touch-opened card carries (lib/viz/tooltip-dismiss). The CARD stays
 * pointer-transparent \u2014 it must never steal the hover it describes \u2014 and only this subtree is
 * tappable; a pointer-events:auto descendant of a pointer-events:none box is hit-testable.
 * It overhangs the card's top-right corner rather than covering its first line.
 *
 * DRAWN at 26px and TAPPED at 44px: a dot big enough for a thumb would cover the card it sits
 * on, so the ::before below is a transparent 44x44 target centred on the button \u2014 the size
 * Apple's HIG and Material both ask for. It is absolutely positioned inside an absolutely
 * positioned button, so it adds the target without moving anything: no layout, no paint.
 */
#vg-tooltip-element .mx-tt-close,
#mx-shared-tooltip .mx-tt-close {
  pointer-events: auto;
  position: absolute;
  top: -10px;
  right: -10px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 999px;
  font: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  color: inherit;
  background: inherit;
  box-shadow: 0 2px 10px -2px rgba(20, 27, 45, 0.35), inset 0 0 0 0.5px rgba(127, 140, 160, 0.35);
}
#vg-tooltip-element .mx-tt-close::before,
#mx-shared-tooltip .mx-tt-close::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 44px;
  height: 44px;
  transform: translate(-50%, -50%);
}
#vg-tooltip-element:has(.mx-tt-close),
#mx-shared-tooltip:has(.mx-tt-close) {
  position: fixed; /* the button anchors to the card; the card is already fixed */
  overflow: visible;
}
.mx-tt-shared .mx-tt-head { opacity: 0.5; font-size: 10.5px; margin-bottom: 5px; letter-spacing: 0.2px; }
.mx-tt-shared .mx-tt-row { display: flex; align-items: center; padding: 1.5px 0; }
.mx-tt-shared .mx-tt-dot { width: 8px; height: 8px; border-radius: 2px; flex: none; margin-right: 8px; }
.mx-tt-shared .mx-tt-name { opacity: 0.82; }
.mx-tt-shared .mx-tt-val { margin-left: auto; padding-left: 20px; font-weight: 600; }
`;function Tt(t){if(t.getElementById(Ot))return;let e=t.createElement("style");e.id=Ot,e.textContent=Ee,t.head.appendChild(e)}var Mt="data-mx-tooltip-card",Lt="mx-tt-close",De="Dismiss tooltip";var St=new WeakMap,At=new WeakSet,Oe=t=>t==="touch"||t==="pen"||t==="mouse"?t:"unknown";function kt(t){At.has(t)||(At.add(t),t.addEventListener("pointerdown",e=>St.set(t,Oe(e.pointerType)),!0))}function Ct(t){return kt(t),St.get(t)??"unknown"}function Ft(t,e){return t==="touch"||t==="pen"?Math.max(e,34):e}var Te=(t,e)=>t instanceof Node&&e.contains(t),Le=t=>t instanceof Element&&t.closest(`[${Mt}]`)!=null;function It(t,e,o){kt(t);let n=()=>o(),r=()=>o(),i=l=>{l.key==="Escape"&&o()},s=l=>{Te(l.target,e)||Le(l.target)||o()};return t.addEventListener("pointercancel",n,!0),t.addEventListener("scroll",r,!0),t.addEventListener("keydown",i,!0),t.addEventListener("pointerdown",s,!0),t.addEventListener("touchmove",s,!0),()=>{t.removeEventListener("pointercancel",n,!0),t.removeEventListener("scroll",r,!0),t.removeEventListener("keydown",i,!0),t.removeEventListener("pointerdown",s,!0),t.removeEventListener("touchmove",s,!0)}}function Nt(t,e,o){t.setAttribute(Mt,"");let n=t.querySelector(`.${Lt}`);if(e!=="touch"&&e!=="pen"){n?.remove();return}if(n)return;let i=t.ownerDocument.createElement("button");i.type="button",i.className=Lt,i.setAttribute("aria-label",De),i.textContent="\xD7",i.addEventListener("click",s=>{s.stopPropagation(),o()}),t.appendChild(i)}var V="vg-tooltip-element",Ae=10;function Me(t){Tt(t);let e=t.getElementById(V);return e||(e=t.createElement("div"),e.id=V,(t.fullscreenElement??t.body).appendChild(e)),e.style.position="fixed",e.style.zIndex="1000",e.style.pointerEvents="none",e.style.whiteSpace="pre-line",e}function U(t){let e=t.getElementById(V);e&&(e.className="vg-tooltip",e.style.visibility="hidden")}var j=new WeakMap;function jt(t,e){let o=j.get(t);o?.chart!==e&&(o?.release(),j.set(t,{chart:e,release:It(t,e,()=>U(t))}))}function ur(t,e){let o=j.get(t);o?.chart===e&&(o.release(),j.delete(t))}function fr(t,e){let o=t.ownerDocument;return jt(o,t),(n,r,i,s)=>{let l=Me(o);if(s==null||s===""){U(o);return}jt(o,t),l.innerHTML=Et(s,Dt,2,o.baseURI),l.className=`vg-tooltip visible ${e}-theme`,l.style.visibility="visible";let a=Ct(o);Nt(l,a,()=>U(o));let u=Ft(a,Ae),f=o.defaultView,m=l.getBoundingClientRect(),T=r.clientX+u,P=r.clientY+u;f&&T+m.width>f.innerWidth&&(T=r.clientX-m.width-u),f&&P+m.height>f.innerHeight&&(P=r.clientY-m.height-u),l.style.left=`${Math.max(0,T)}px`,l.style.top=`${Math.max(0,P)}px`}}function pr(){let t="JetBrains Mono, Consolas, Monaco, Courier New, monospace";return typeof document>"u"?t:getComputedStyle(document.documentElement).getPropertyValue("--font-jetbrains-mono").trim()||t}var c={primary:"#2980b9",danger:"#c0392b",teal:"#16a085",purple:"#9b59b6",success:"#2ecc71",warning:"#f39c12",turquoise:"#1abc9c",nephritis:"#27ae60",peterRiver:"#3498db",wisteria:"#8e44ad",sunflower:"#f1c40f",carrot:"#e67e22",silver:"#bdc3c7",moonlight:"#34495e",coral:"#e74c3c",rose:"#d63384",indigo:"#5b4cc4",cyan:"#0097a7",olive:"#7cb342",magenta:"#c2185b",brown:"#8d6e63",slate:"#546e7a",ocean:"#0984e3",forest:"#00897b",wine:"#880e4f",steel:"#455a64"},dr=[c.teal,c.primary,c.danger,c.sunflower,c.purple,c.carrot,c.silver,c.moonlight,c.rose,c.forest,c.ocean,c.olive,c.magenta,c.cyan,c.indigo,c.brown,c.coral,c.nephritis,c.wine,c.peterRiver,c.slate,c.success,c.wisteria,c.steel],mr={bgCanvas:"#FAFBFC",bgSurface:"#FFFFFF",bgMuted:"#F6F8FA",fgDefault:"#0D1117",fgMuted:"#57606A",fgSubtle:"#8B949E",borderDefault:"#D0D7DE",borderMuted:"#E5E9ED"},hr={bgCanvas:"#0D1117",bgSurface:"#161B22",bgMuted:"#010409",fgDefault:"#E6EDF3",fgMuted:"#8B949E",fgSubtle:"#6E7681",borderDefault:"#30363D",borderMuted:"#21262D"};export{p as a,Pt as b,z as c,x as d,E as e,D as f,Ht as g,$t as h,Vt as i,Ut as j,Bt as k,Wt as l,qt as m,B as n,W as o,q as p,X as q,Y as r,Yt as s,b as t,h as u,Gt as v,R as w,d as x,A as y,Kt as z,_t as A,Zt as B,Qt as C,te as D,ee as E,oe as F,ne as G,re as H,ie as I,w as J,ot as K,y as L,nt as M,H as N,fe as O,rt as P,C as Q,it as R,st as S,g as T,lt as U,ce as V,pe as W,at as X,ut as Y,I as Z,ft as _,N as $,ct as aa,O as ba,pt as ca,de as da,he as ea,dt as fa,v as ga,mt as ha,xe as ia,$ as ja,ht as ka,gt as la,xt as ma,bt as na,yt as oa,wt as pa,Tt as qa,Ct as ra,Ft as sa,It as ta,Nt as ua,U as va,ur as wa,fr as xa,pr as ya,dr as za,mr as Aa,hr as Ba};
