import {expect,it} from 'vitest';
import {runFailureMessage} from '../lib/run-failure-message';
it('gives known expiry reasons a readable limit and next action',()=>{for(const reason of ['timeout','deadline'])expect(runFailureMessage(reason)).toBe('The run reached its time limit. Shorten the command or increase its allowed runtime, then try again.');});
it('describes ambiguous process termination without claiming a timeout',()=>{expect(runFailureMessage('process_exit_137')).toBe('The process was terminated (exit code 137). Check its memory and time limits before trying again.');expect(runFailureMessage('process_exit_124')).toBe('The process exited with code 124. Check the command and its output before trying again.');});
it('preserves meaningful author errors and non-code details',()=>{expect(runFailureMessage('mxmx_test deterministic failure')).toBe('mxmx_test deterministic failure');});
