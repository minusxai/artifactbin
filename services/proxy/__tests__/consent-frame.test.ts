import {runInNewContext} from 'node:vm';
import {expect,it,vi} from 'vitest';
import {frameConsent} from '../src/routes/consent-frame';

it.each([null,[],{redirect:42}].map(reply=>({reply})))('refuses malformed approval JSON without forwarding a callback: $reply',async ({reply})=>{
  const html=await (await frameConsent(new Response('<body></body>'),'https://example.test')).text();
  const script=/<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1];
  const parent={postMessage:vi.fn()},button={disabled:false};
  const error={id:'',textContent:'',setAttribute:vi.fn()};
  const form={method:'post',querySelector:()=>button,append:vi.fn()};
  let submit!:(event:{target:unknown;preventDefault:()=>void})=>Promise<void>;
  const document={title:'Consent',addEventListener:(_type:string,handler:typeof submit)=>{submit=handler;},getElementById:()=>null,createElement:()=>error};
  runInNewContext(script,{parent,document,URL,FormData:class extends FormData{constructor(){super();}},fetch:async()=>Response.json(reply)});
  await submit({target:form,preventDefault:vi.fn()});
  expect(button.disabled).toBe(false);
  expect(error.textContent).toBe('This approval expired or was already used. Reload to try again.');
  expect(parent.postMessage.mock.calls.map(call=>call[0].type)).toEqual(['mx:page:title','mx:page:ready']);
});
