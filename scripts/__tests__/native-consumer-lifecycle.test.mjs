import {it,expect,vi} from 'vitest';
import {nativeBootstrapCheck,cleanupFailedNativeConsumer} from '../../services/cli/scripts/native-consumer-lifecycle.mjs';
it('launches native PS5.1 with its own module roots instead of inherited PS7 modules',()=>{
 const environment={SystemRoot:'C:\\Windows',PSModulePath:'C:\\Program Files\\PowerShell\\7\\Modules',PATH:'node-tools',RUNNER_TEMP:'fixture'};
 const check=nativeBootstrapCheck({platform:'win32',executable:'node.exe',repository:'repo',tarball:'candidate.tgz',environment});
 expect(check.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 expect(check.env.PSModulePath).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules');
 expect(check.env.RUNNER_TEMP).toBe('fixture');
 expect(check.args).toEqual(['-NoProfile','-File','services/cli/scripts/test-node-bootstrap.ps1','-Tarball','candidate.tgz']);
 expect(environment.PSModulePath).toContain('PowerShell\\7');
});
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
