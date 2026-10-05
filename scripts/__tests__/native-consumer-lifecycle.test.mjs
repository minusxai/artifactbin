import {it,expect,vi} from 'vitest';
import {cleanupFailedNativeConsumer} from '../../services/cli/scripts/native-consumer-lifecycle.mjs';
it('keeps loaded Windows native binaries for runner cleanup without masking the proof failure',async()=>{
 const remove=vi.fn().mockRejectedValue(Error('EPERM conpty.node'));
 await expect(cleanupFailedNativeConsumer('scratch',{platform:'win32',nativeLoaded:true,remove})).resolves.toBeUndefined();
 expect(remove).not.toHaveBeenCalled();
});
it('removes unloaded and Unix consumers but leaves any cleanup error secondary',async()=>{
 const remove=vi.fn().mockResolvedValue(undefined);
 await cleanupFailedNativeConsumer('scratch',{platform:'win32',nativeLoaded:false,remove});
 expect(remove).toHaveBeenCalledWith('scratch',{recursive:true,force:true});
 const broken=vi.fn().mockRejectedValue(Error('cleanup failed'));
 await expect(cleanupFailedNativeConsumer('scratch',{platform:'darwin',nativeLoaded:true,remove:broken})).resolves.toBeUndefined();
 expect(broken).toHaveBeenCalled();
});
