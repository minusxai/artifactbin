import {it,expect,vi} from 'vitest';
import {removeTerminalWorkspace} from '../../services/cli/scripts/terminal-workspace-cleanup.mjs';
it('retries only a temporary busy cwd handle and then removes it',async()=>{
 const busy=Object.assign(Error('cwd still busy'),{code:'EBUSY'});
 const remove=vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValue(undefined),wait=vi.fn();
 await removeTerminalWorkspace('scratch',{remove,wait});
 expect(remove).toHaveBeenCalledTimes(3);expect(wait.mock.calls).toEqual([[100],[200]]);
 expect(remove).toHaveBeenLastCalledWith('scratch',{recursive:true,force:true});
});
it('keeps retry bounds and propagates persistent EBUSY or any other failure',async()=>{
 const busy=Object.assign(Error('busy'),{code:'EBUSY'}),remove=vi.fn().mockRejectedValue(busy),wait=vi.fn();
 await expect(removeTerminalWorkspace('scratch',{remove,wait,attempts:3})).rejects.toBe(busy);
 expect(remove).toHaveBeenCalledTimes(3);expect(wait).toHaveBeenCalledTimes(2);
 const denied=Object.assign(Error('denied'),{code:'EACCES'}),other=vi.fn().mockRejectedValue(denied);
 await expect(removeTerminalWorkspace('scratch',{remove:other,wait})).rejects.toBe(denied);
 expect(other).toHaveBeenCalledTimes(1);
});
