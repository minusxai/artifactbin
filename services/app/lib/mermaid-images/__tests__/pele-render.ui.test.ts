import {embedPageFonts} from '../mermaid-fonts';
import {expect,it} from 'vitest';
import {renderMermaid,type MermaidPalette} from '../mermaid-render';
const palette:MermaidPalette={background:'#ffffff',foreground:'#111111',primary:'#2255aa',border:'#999999',card:'#f8f8f8',muted:'#eeeeee',accent:'#dddddd',mutedForeground:'#666666',fontFamily:'serif',fontMono:'monospace',fontSize:'14px',dark:false};
it('backs the retained image renderer with Pele and carries concrete theme/font values inside the SVG image',async()=>{
 const image=await renderMermaid('flowchart LR\n Draft --> Published',palette);
 const svg=decodeURIComponent(image.src.split(',').slice(1).join(','));
 expect(svg).toContain('pele-flowchart');expect(svg).toContain('--pele-fg: #111111');expect(svg).toContain('--pele-font: serif');expect(svg).toContain('Draft');expect(svg).toContain('Published');expect(image.width).toBeGreaterThan(0);expect(image.height).toBeGreaterThan(0);
 const dark=await renderMermaid('sequenceDiagram\n Reader->>Server: Request',{...palette,dark:true,background:'#111111',foreground:'#eeeeee'});expect(decodeURIComponent(dark.src)).toContain('--pele-fg: #eeeeee');
 const embedded=await embedPageFonts(svg,{label:'serif',edge:'monospace'},[{family:'serif',url:'/font.woff2',weight:'400'}],async()=> 'data:font/woff2;base64,YWJj');expect(embedded).toContain('@font-face');
 const repeated=await renderMermaid('flowchart LR\n Draft --> Published',palette);expect(decodeURIComponent(repeated.src).replace(/mx-mermaid-\d+/g,'stable')).toBe(decodeURIComponent(image.src).replace(/mx-mermaid-\d+/g,'stable'));
 const fallback=await renderMermaid('flowchart LR\n A --> B',{...palette,fontSize:'bad'});expect(Number.isFinite(fallback.width)).toBe(true);expect(Number.isFinite(fallback.height)).toBe(true);
 await expect(renderMermaid('flowchart\n A -->',palette)).rejects.toThrow();
});
