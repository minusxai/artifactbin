/** Highlight-token colours (`tok-*` classes of the hosted `highlight` library). Each token keeps its design-system
 * hue but is mixed toward the text colour with `color-mix(in oklab)`, by a fixed percentage chosen as the largest
 * that keeps WCAG AA (4.5:1) on both `--background` and `--muted`, in light and dark, for every system. */
export const TOKEN_RULES=[
 {names:['comment','quote','meta'],hue:'--muted-foreground',mix:75,css:'font-style:italic'},
 {names:['keyword','selector-tag','doctag','name'],hue:'--primary',mix:66},
 {names:['string','regexp','template-variable','addition'],hue:'--chart-2',mix:59},
 {names:['number','literal','symbol','bullet'],hue:'--chart-3',mix:35},
 {names:['title','section','selector-id','selector-class'],hue:'--foreground',mix:100,css:'font-weight:600'},
 {names:['title.class_','type','built_in','class'],hue:'--chart-4',mix:47},
 {names:['attr','attribute','property','variable','params'],hue:'--chart-1',mix:66},
 {names:['tag','operator','punctuation'],hue:'--muted-foreground',mix:75},
 {names:['deletion'],hue:'--destructive',mix:66},
 {names:['emphasis'],css:'font-style:italic'},
 {names:['strong'],css:'font-weight:700'},
];
export const tokenRuleCss=rule=>[rule.hue&&(rule.mix>=100?`color:var(${rule.hue})`:`color:color-mix(in oklab, var(${rule.hue}) ${rule.mix}%, var(--foreground))`),rule.css].filter(Boolean).join(';');

const lin=c=>c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;
const gam=c=>c<=0.0031308?12.92*c:1.055*c**(1/2.4)-0.055;
const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
export const toOklab=hex=>{const [r,g,b]=rgb(hex).map(lin);
 const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b),m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b),s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
 return [0.2104542553*l+0.7936177850*m-0.0040720468*s,1.9779984951*l-2.4285922050*m+0.4505937099*s,0.0259040371*l+0.7827717662*m-0.8086757660*s];};
export const fromOklab=([L,a,b])=>{const l=(L+0.3963377774*a+0.2158037573*b)**3,m=(L-0.1055613458*a-0.0638541728*b)**3,s=(L-0.0894841775*a-1.2914855480*b)**3;
 return [4.0767416621*l-3.3077115913*m+0.2309699292*s,-1.2684380046*l+2.6097574011*m-0.3413193965*s,-0.0041960863*l-0.7034186147*m+1.7076147010*s].map(c=>Math.min(1,Math.max(0,gam(c))));};
/** sRGB triple of `color-mix(in oklab, first pct%, second)`. */
export const mixOklab=(first,pct,second)=>{const a=toOklab(first),b=toOklab(second),t=pct/100;return fromOklab(a.map((v,i)=>v*t+b[i]*(1-t)));};
const rel=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
export const contrast=(x,y)=>{const [hi,lo]=[rel(x),rel(y)].sort((p,q)=>q-p);return (hi+0.05)/(lo+0.05);};
/** Colour a token renders in for one resolved palette: {hue,foreground,background,muted} as hex. */
// Rendered colours are 8-bit, so verify the quantized result.
const eightBit=c=>c.map(v=>Math.round(v*255)/255);
export const tokenColor=(rule,palette)=>rule.mix>=100?rgb(palette[rule.hue]):eightBit(mixOklab(palette[rule.hue],rule.mix,palette['--foreground']));
export const tokenContrasts=(rule,palette)=>['--background','--muted'].map(ground=>contrast(tokenColor(rule,palette),rgb(palette[ground])));
