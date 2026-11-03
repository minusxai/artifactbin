import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const engine=vi.hoisted(()=>({renderMermaid:vi.fn(async()=>({src:'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',type:'flowchart-v2',width:10,height:5}))}));
vi.mock('../mermaid-render',()=>engine);
import {drawForReader,paletteFor} from '../reader-draw';
beforeEach(()=>{vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);});
afterEach(()=>{vi.restoreAllMocks();document.body.innerHTML='';});
it('falls back to the mode defaults without a canvas and clamps the label size to 12–16px',()=>{
 const element=document.createElement('div');document.body.append(element);
 element.style.fontSize='30px';element.style.fontFamily='"Inter", sans-serif';
 expect(paletteFor(element,false)).toMatchObject({dark:false,background:'#ffffff',foreground:'#111827',primary:'#2563eb',fontSize:'16px',fontFamily:'"Inter", sans-serif',fontMono:'ui-monospace, Menlo, monospace'});
 element.style.fontSize='8px';expect(paletteFor(element,true)).toMatchObject({dark:true,background:'#111827',foreground:'#f9fafb',fontSize:'12px'});
 element.style.fontSize='13.6px';expect(paletteFor(element,true).fontSize).toBe('14px');
});
it('draws in the element’s theme and drops a drawing no longer wanted',async()=>{
 const element=document.createElement('div');document.body.append(element);
 const drawn=await drawForReader(element,'graph TD; A-->B',false,()=>true);
 expect(engine.renderMermaid).toHaveBeenCalledWith('graph TD; A-->B',expect.objectContaining({dark:false}));
 // jsdom has no font set: the drawing carries no page fonts and comes back as the engine drew it.
 expect(drawn).toEqual({image:{src:'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',type:'flowchart-v2',width:10,height:5}});
 expect(await drawForReader(element,'graph TD; A-->B',false,()=>false)).toBeNull();
 engine.renderMermaid.mockRejectedValueOnce(Error('Parse error'));
 await expect(drawForReader(element,'graph TD; A-->',false,()=>true)).rejects.toThrow('Parse error');
});
