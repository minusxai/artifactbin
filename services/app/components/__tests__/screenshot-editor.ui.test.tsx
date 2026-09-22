import {act,fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ScreenshotEditor from '../ScreenshotEditor';
it('embeds brush controls without a separate dialog or completion step',()=>{
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const close=vi.fn();
 render(<ScreenshotEditor image={{blob:new Blob(),width:100,height:50,rect:{x:0,y:0,width:100,height:50},viewport:{width:100,height:50},capturedAt:new Date().toISOString(),method:'region'}} initialStrokes={[]} exportRef={{current:null}} busy={false} onRetake={close}/>);
 expect(screen.getByLabelText('Brush color')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Blue brush'})).toBeTruthy();
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(screen.queryByRole('button',{name:'Use screenshot'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Brush thickness'),{target:{value:'8'}});
 expect((screen.getByLabelText('Brush thickness') as HTMLInputElement).value).toBe('8');
 expect(screen.getByRole('button',{name:'Undo stroke'})).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('button',{name:'Retake screenshot'}));expect(close).toHaveBeenCalledOnce();
});

it('exports the current drawing on demand and invalidates the cached image after undo',async()=>{
 let loaded:()=>void=()=>{};
 vi.stubGlobal('Image',class {set onload(value:()=>void){loaded=value;} set src(_value:string){}});
 const context={clearRect:vi.fn(),drawImage:vi.fn(),beginPath:vi.fn(),arc:vi.fn(),fill:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn()};
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
 const encode=vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(callback=>callback(new Blob(['drawing'],{type:'image/png'})));
 const exportRef:{current:(()=>Promise<import('../ScreenshotEditor').ScreenshotDrawing>)|null}={current:null};
 const view=render(<ScreenshotEditor image={{blob:new Blob(),width:100,height:50,rect:{x:0,y:0,width:100,height:50},viewport:{width:100,height:50},capturedAt:new Date().toISOString(),method:'canvas'}} initialStrokes={[{color:'#ef4444',width:3,points:[[10,10],[20,20]]}]} exportRef={exportRef} busy={false} onRetake={vi.fn()}/>);
 await act(async()=>loaded());
 const first=await exportRef.current!();
 expect(first.strokes).toHaveLength(1);
 expect(await exportRef.current!()).toBe(first);
 expect(encode).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Undo stroke'}));
 const second=await exportRef.current!();
 expect(second.strokes).toEqual([]);
 expect(second.preview).not.toBe(first.preview);
 view.unmount();expect(exportRef.current).toBeNull();
 vi.unstubAllGlobals();
});
