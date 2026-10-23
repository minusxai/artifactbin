/* @jsxImportSource solid-js */
import {expect,it} from 'vitest';
import {render} from '../../__tests__/helpers';
import DocsHuman from '../DocsHuman';
it('explains skill installation and native publication without retired product promises',()=>{
 const view=render(()=><DocsHuman/>);const text=view.container.textContent!;
 expect(text).toContain('authenticated HTTP API');expect(text).toContain('author skill');expect(text).toContain('conditional replacement');
 expect(view.getByRole('link',{name:'Getting started guide'})).toHaveAttribute('href','/getting-started');
 expect(text).not.toMatch(/Install afbin|over the CLI|opens in a visual editor|drag and resize in the editor|mx-markup/);
});
