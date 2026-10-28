// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../mermaid-images/reader-draw',()=>({drawForReader:vi.fn()}));
import {drawForReader} from '../mermaid-images/reader-draw';
import {AfMermaid,type MermaidContract} from './mermaid';
import './mermaid';
afterEach(()=>{document.body.replaceChildren();vi.resetAllMocks();});
const tick=async()=>{for(let i=0;i<12;i++) await Promise.resolve();};
it('ignores stale results and disconnected drawings; retries errors',async()=>{
 let finish!:(value:unknown)=>void; vi.mocked(drawForReader).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve as typeof finish;}));
 const el=document.createElement('af-mermaid') as AfMermaid; el.code='graph TD; A-->B'; document.body.append(el); await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 vi.mocked(drawForReader).mockRejectedValueOnce(new Error('syntax')); el.code='bad'; await vi.waitFor(()=>expect(el.dataset.state).toBe('error')); finish({image:{src:'data:image/svg+xml,a',type:'flowchart'}}); await tick(); expect(el.querySelector('img')).toBeNull(); expect(el.dataset.state).toBe('error');
 vi.mocked(drawForReader).mockResolvedValueOnce({image:{src:'data:image/svg+xml,b',type:'flowchart'}}); el.retry(); await vi.waitFor(()=>expect(el.querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,b'));  el.remove();
});
it('uses stored images, falls back on image failure and inherits dark mode',async()=>{
 vi.mocked(drawForReader).mockResolvedValue({image:{src:'data:image/svg+xml,new',type:'flowchart'}});
 const el=document.createElement('af-mermaid') as AfMermaid; el.code='graph TD; A-->B'; const contract:MermaidContract=el; expect(contract.colorMode).toBe('auto'); el.storedImage={src:'data:image/svg+xml,stored',type:'flowchart'}; el.setAttribute('data-af-dark',''); document.body.append(el); expect(drawForReader).not.toHaveBeenCalled();
 el.querySelector('img')?.dispatchEvent(new Event('error')); await vi.waitFor(()=>expect(drawForReader).toHaveBeenCalledWith(el,el.code,true,expect.any(Function))); 
});
it('redraws for ancestor theme changes and rejects completions after disposal',async()=>{
 const pending:Array<(value:Awaited<ReturnType<typeof drawForReader>>)=>void>=[];
 vi.mocked(drawForReader).mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const parent=document.createElement('div'); const el=document.createElement('af-mermaid') as AfMermaid; el.code='graph TD; A-->B'; parent.append(el); document.body.append(parent);
 await vi.waitFor(()=>expect(pending).toHaveLength(1)); parent.setAttribute('data-af-dark',''); await vi.waitFor(()=>expect(pending).toHaveLength(2)); expect(vi.mocked(drawForReader).mock.calls[1]?.[2]).toBe(true);
 pending[0]!({image:{src:'data:image/svg+xml,old',type:'flowchart'}}); await tick(); expect(el.querySelector('img')).toBeNull(); el.remove();pending[1]!({image:{src:'data:image/svg+xml,new',type:'flowchart'}});await tick();expect(el.querySelector('img')).toBeNull();
});
it('makes properties authoritative over attributes and invalidates attribute-source stored images',async()=>{
 vi.mocked(drawForReader).mockResolvedValue({image:{src:'data:image/svg+xml,fresh',type:'flowchart'}});
 const el=document.createElement('af-mermaid') as AfMermaid;el.setAttribute('code','graph TD; A-->B');el.storedImage={src:'data:image/svg+xml,stale',type:'flowchart'};document.body.append(el);expect(el.querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,stale');
 el.code='graph TD; B-->C';await vi.waitFor(()=>expect(el.querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,fresh'));expect(el.storedImage).toBeNull();
 el.setAttribute('code','graph TD; C-->D');expect(el.code).toBe('graph TD; B-->C');
});
it('follows code attribute changes until a property takes control',async()=>{
 vi.mocked(drawForReader).mockResolvedValue({image:{src:'data:image/svg+xml,fresh',type:'flowchart'}});const el=document.createElement('af-mermaid') as AfMermaid;el.textContent='graph TD; A-->B';document.body.append(el);expect(el.code).toBe('graph TD; A-->B');el.setAttribute('code','graph TD; B-->C');expect(el.code).toBe('graph TD; B-->C');
 el.code='graph TD; C-->D';el.setAttribute('code','graph TD; D-->E');expect(el.code).toBe('graph TD; C-->D');
});
it('uses explicit false and true ancestor dark attributes',async()=>{
 vi.mocked(drawForReader).mockResolvedValue({image:{src:'data:image/svg+xml,new',type:'flowchart'}});const parent=document.createElement('div');parent.setAttribute('data-af-dark','false');const el=document.createElement('af-mermaid') as AfMermaid;el.code='graph TD; A-->B';parent.append(el);document.body.append(parent);
 await vi.waitFor(()=>expect(vi.mocked(drawForReader).mock.calls.at(-1)?.[2]).toBe(false));parent.setAttribute('data-af-dark','true');await vi.waitFor(()=>expect(vi.mocked(drawForReader).mock.calls.at(-1)?.[2]).toBe(true));
});
it('styles captions with the original compact medium monospace role',()=>{
 const css=document.querySelector('style[data-af-mermaid-styles]')?.textContent ?? '';
 expect(css).toContain('af-mermaid figcaption{font-family:var(--font-mono,monospace);font-size:.875rem;line-height:1.25rem;font-weight:500;margin-bottom:.5rem}');
});
