import type {MermaidPalette} from './mermaid-contracts.ts';
/** Frozen reader palette contract, resolved from the actual host rather than a theme-name guess. */
export function mermaidPalette(element:HTMLElement,dark:boolean):MermaidPalette {
 const style=getComputedStyle(element),canvas=document.createElement('canvas');canvas.width=canvas.height=1;
 const ctx=canvas.getContext('2d');
 const color=(name:string,fallback:string)=>{if(!ctx)return fallback;ctx.clearRect(0,0,1,1);ctx.fillStyle=fallback;ctx.fillStyle=style.getPropertyValue(name).trim()||fallback;ctx.fillRect(0,0,1,1);return '#'+[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');};
 const size=Number.parseFloat(style.fontSize);
 return {dark,background:color('--background',dark?'#111827':'#ffffff'),foreground:color('--foreground',dark?'#f9fafb':'#111827'),primary:color('--primary','#2563eb'),border:color('--border','#9ca3af'),card:color('--card',dark?'#1f2937':'#ffffff'),muted:color('--muted',dark?'#1f2937':'#f3f4f6'),accent:color('--accent',dark?'#1f2937':'#f3f4f6'),mutedForeground:color('--muted-foreground',dark?'#9ca3af':'#6b7280'),fontFamily:style.fontFamily.trim()||'system-ui, sans-serif',fontMono:style.getPropertyValue('--font-mono').trim()||'ui-monospace, Menlo, monospace',fontSize:(Number.isFinite(size)&&size>0?Math.round(Math.min(Math.max(size,12),16)):14)+'px'};
}
