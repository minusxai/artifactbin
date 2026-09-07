import {describe,it,expect} from 'vitest';
import {protectedAuthorDocument} from '../author-frame';
import {startAuthorScript} from '../author-script';
import {createDataflowStore} from '../store';
describe('protected author frame contract',()=>{
 it('keeps inner document inert within a trusted navigation-restricting wrapper',()=>{
  const doc=new DOMParser().parseFromString(protectedAuthorDocument('<script>window.innerAuthor=true</script>'),'text/html');
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("frame-src 'none'");
  expect(doc.querySelectorAll('script')).toHaveLength(1);
  expect(doc.querySelector('script')?.textContent).not.toContain('<script>window.innerAuthor');
 });
 it('mounts the actual session through the wrapper, preserving opaque sandboxing',()=>{
  const store=createDataflowStore({flow:{values:[],queries:[]}});
  const stop=startAuthorScript('void 0',store);
  const frame=document.querySelector('iframe')!;
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.srcdoc).toContain('data-mx-author-wrapper');
  stop();expect(document.querySelector('iframe')).toBeNull();
 });
});
