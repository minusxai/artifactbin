import {expect,it} from 'vitest';
import {CaptureError} from '../contract';
it('names the capture failure and the stage it happened in',()=>{
 const error=new CaptureError('timeout','initial-frame');
 expect(error).toBeInstanceOf(Error);
 expect(error).toMatchObject({name:'CaptureError',message:'timeout',code:'timeout',stage:'initial-frame'});
 expect(new CaptureError('cancelled').stage).toBeUndefined();
});
