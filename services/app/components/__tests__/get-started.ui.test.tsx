import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import GetStarted from '../GetStarted';
afterEach(cleanup);
it('offers the CLI install, names the four agents it installs skills for, and the live-document button',()=>{
 const {container}=render(<GetStarted />);
 expect(screen.getByRole('button',{name:'Copy the CLI install command'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Copy the Windows CLI install command'})).toBeInTheDocument();
 expect(container.textContent).toContain('install.ps1');
 expect(container.textContent).toContain('powershell.exe -NoProfile -ExecutionPolicy Bypass -File');
 expect(screen.getByLabelText('Create a live document for my agent')).toBeInTheDocument();
 for(const harness of ['Claude Code','Codex','pi','OpenCode'])expect(container.textContent).toContain(harness);
 expect(container.textContent).not.toMatch(/MCP|no installation|plugin/i);
 expect(container.querySelector('a[href^="/docs/"]')).toBeNull();
});
