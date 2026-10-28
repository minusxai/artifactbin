import {expect,it,vi} from 'vitest';
import {createUploadContext,bindUploadControl} from '../upload-context';
it('availability is immediate, independently observed, and safe before trusted context',()=>{
 const context=createUploadContext(false),seen:string[]=[];
 expect(context.read().state).toBe('unavailable');
 const bad=context.watch(()=>{throw Error('observer failed');});
 const sub=context.watch(value=>seen.push(value.state));
 context.update({state:'loading',scope:'first'});context.update({state:'signed-out',scope:'second'});
 expect(seen).toEqual(['unavailable','loading','signed-out']);bad.unsubscribe();sub.unsubscribe();
 context.update({state:'signed-in',scope:'third'});expect(seen).toHaveLength(3);
 const portable=createUploadContext(true);portable.update({state:'signed-in',scope:'ignored'});expect(portable.read().state).toBe('read-only');
});
it('caller initializer disables guests with sign-in help, cancels across subjects and preserves caller disabled state',()=>{
 const context=createUploadContext(false),reset=vi.fn();
 const control={disabled:false,helperText:'',reset,adapter:undefined as any};
 const original={upload:vi.fn()};control.adapter=original;
 const adapter={upload:vi.fn()};const binding=bindUploadControl(control,adapter,context.watch,{helperText:'Choose a receipt.'});
 expect(control.disabled).toBe(true);expect(control.helperText).toBe('Uploads unavailable.');
 context.update({state:'signed-out',scope:'guest'});expect(control.helperText).toBe('Sign in to upload files.');expect(control.disabled).toBe(true);
 context.update({state:'signed-in',scope:'account-a'});expect(control.disabled).toBe(false);expect(control.helperText).toBe('Choose a receipt.');
 binding.setDisabled(true);context.update({state:'signed-in',scope:'account-b'});expect(control.disabled).toBe(true);expect(reset).toHaveBeenCalled();
 binding.setDisabled(false);expect(control.disabled).toBe(false);
 context.update({state:'loading',scope:'pending'});expect(control.disabled).toBe(true);expect(control.helperText).toBe('Checking upload availability…');
 context.update({state:'unavailable',scope:'error'});expect(control.disabled).toBe(true);
 binding.dispose();expect(control.adapter).toBe(original);expect(control.disabled).toBe(true);
 context.update({state:'signed-in',scope:'later'});expect(control.disabled).toBe(true);
});
