import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import GetStarted from '../GetStarted';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('offers the CLI install, names the four agents it installs skills for, and the live-document button',()=>{
 const {container}=render(<GetStarted />);
 expect(screen.getByRole('button',{name:'Copy the CLI install command'})).toBeInTheDocument();
 expect(container.textContent).toContain('Invoke-WebRequest -UseBasicParsing');
 expect(container.textContent).toContain('powershell.exe -NoProfile -ExecutionPolicy Bypass -File');
 expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
 for(const harness of ['Claude Code','Codex','pi','OpenCode'])expect(container.textContent).toContain(harness);
 expect(container.textContent).not.toMatch(/MCP|no installation|plugin/i);
 expect(container.querySelector('a[href^="/docs/"]')).toBeNull();
});
it('shows Windows instructions first and macOS/Linux below without a dropdown on Windows',()=>{
 vi.spyOn(window.navigator,'platform','get').mockReturnValue('Win32');
 render(<GetStarted />);
 const windows=screen.getByRole('button',{name:'Copy the Windows CLI install command'});
 const unix=screen.getByRole('button',{name:'Copy the CLI install command'});
 expect(windows).toBeVisible();
 expect(unix).toBeVisible();
 expect(windows.compareDocumentPosition(unix)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(screen.getByText('macOS / Linux')).toBeVisible();
 expect(screen.queryByText('See Windows instructions')).not.toBeInTheDocument();
});
it('keeps Windows instructions collapsed until requested and lets readers close them again',()=>{
 render(<GetStarted />);
 const summary=screen.getByText('See Windows instructions');
 const instructions=screen.getByText('Windows x64 · PowerShell');
 expect(instructions).not.toBeVisible();
 expect(screen.getByText('Open a new terminal after installation.')).not.toBeVisible();
 fireEvent.click(summary);
 expect(instructions).toBeVisible();
 expect(screen.getByRole('button',{name:'Copy the Windows CLI install command'})).toBeVisible();
 expect(screen.getByText('Open a new terminal after installation.')).toBeVisible();
 fireEvent.click(summary);
 expect(instructions).not.toBeVisible();
});
