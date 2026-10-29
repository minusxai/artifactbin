import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {parseMermaidFaces} from '..';
const engine=vi.hoisted(()=>({renderMermaid:vi.fn(async()=>({src:'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',type:'flowchart-v2',width:10,height:5}))}));
vi.mock('../mermaid-render',()=>engine);
import {drawForReader,facesOf,paletteFor} from '../reader-draw';
beforeEach(()=>{vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null);});
afterEach(()=>{vi.restoreAllMocks();document.body.innerHTML='';});
it('falls back to the mode defaults without a canvas and clamps the label size to 12–16px',()=>{
 const element=document.createElement('div');document.body.append(element);
 element.style.fontSize='30px';element.style.fontFamily='"Inter", sans-serif';
 expect(paletteFor(element,false)).toMatchObject({dark:false,background:'#ffffff',foreground:'#111827',primary:'#2563eb',fontSize:'16px',fontFamily:'"Inter", sans-serif',fontMono:'ui-monospace, Menlo, monospace'});
 element.style.fontSize='8px';expect(paletteFor(element,true)).toMatchObject({dark:true,background:'#111827',foreground:'#f9fafb',fontSize:'12px'});
 element.style.fontSize='13.6px';expect(paletteFor(element,true).fontSize).toBe('14px');
});
it('records the leading label and edge faces at the label size, refusing an unparseable stack',()=>{
 const palette=paletteFor(document.body,false);
 const faces=facesOf({...palette,fontFamily:'"Inter", sans-serif',fontMono:'JetBrains Mono, monospace',fontSize:'14px'});
 expect(parseMermaidFaces(faces)).toEqual({label:'Inter',size:14,edge:'JetBrains Mono'});
 expect(facesOf({...palette,fontFamily:'',fontMono:'x',fontSize:'14px'})).toBeUndefined();
});
it('draws in the element’s theme, marks a drawing whose fonts held still, and drops a drawing no longer wanted',async()=>{
 const element=document.createElement('div');document.body.append(element);
 const drawn=await drawForReader(element,'graph TD; A-->B',false,()=>true);
 expect(engine.renderMermaid).toHaveBeenCalledWith('graph TD; A-->B',expect.objectContaining({dark:false}));
 // jsdom has no font set or text layout: the drawing is not portable and carries no metrics, only its palette key and faces.
 expect(drawn).toMatchObject({image:{type:'flowchart-v2'},palette:expect.stringMatching(/^[0-9a-f]{32}$/),portable:false});
 expect(drawn).not.toHaveProperty('metrics');
 expect(await drawForReader(element,'graph TD; A-->B',false,()=>false)).toBeNull();
 engine.renderMermaid.mockRejectedValueOnce(Error('Parse error'));
 await expect(drawForReader(element,'graph TD; A-->',false,()=>true)).rejects.toThrow('Parse error');
});
