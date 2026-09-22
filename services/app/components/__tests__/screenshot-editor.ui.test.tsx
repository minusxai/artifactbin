import {fireEvent,render,screen} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import ScreenshotEditor from '../ScreenshotEditor';
it('offers only a brush, color, thickness, undo and completion',()=>{
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const close=vi.fn();
 render(<ScreenshotEditor image={{blob:new Blob(),width:100,height:50,rect:{x:0,y:0,width:100,height:50},viewport:{width:100,height:50},capturedAt:new Date().toISOString(),method:'region'}} initialStrokes={[]} onDone={vi.fn()} onCancel={close}/>);
 expect(screen.getByLabelText('Brush color')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Brush thickness'),{target:{value:'8'}});
 expect((screen.getByLabelText('Brush thickness') as HTMLInputElement).value).toBe('8');
 expect(screen.getByRole('button',{name:'Undo stroke'})).toHaveProperty('disabled',true);
 fireEvent.click(screen.getByRole('button',{name:'Cancel drawing'}));expect(close).toHaveBeenCalledOnce();
});
