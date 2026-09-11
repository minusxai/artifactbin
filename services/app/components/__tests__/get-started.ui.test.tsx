import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import GetStarted from '../GetStarted';
afterEach(cleanup);
it('offers one local CLI setup flow with browser approval and a downloadable local bundle',()=>{
 const {container}=render(<GetStarted />);
 expect(screen.getByRole('button',{name:'Copy the CLI install command'})).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Copy the setup command'})).toBeInTheDocument();
 expect(container.textContent).toContain('afbin setup');
 expect(container.textContent).toMatch(/browser/i);
 for(const harness of ['Claude Code','Codex','pi','OpenCode'])expect(container.textContent).toContain(harness);
 expect(screen.getByRole('link',{name:'Download local skills'}).getAttribute('href')).toMatch(/releases\/download\/afbin-v[\d.]+\/afbin-skills.tar.gz$/);
 expect(container.textContent).not.toMatch(/MCP|no installation|plugin/i);
 expect(container.querySelector('a[href^="/docs/"]')).toBeNull();
});
