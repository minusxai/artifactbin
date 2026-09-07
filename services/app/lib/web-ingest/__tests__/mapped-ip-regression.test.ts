import {describe,it,expect} from 'vitest';
import {parseWebUrl} from '../guard';
describe('normalized mapped IPv6 SSRF regression',()=>{
 it.each(['::ffff:127.0.0.1','::ffff:7f00:1','0:0:0:0:0:ffff:7f00:1'])('rejects mapped loopback %s',ip=>{
  expect(()=>parseWebUrl(`https://[${ip}]/`,{allowPrivate:false,allowHttp:false})).toThrow(/fetchable/);
 });
 it.each(['::ffff:169.254.169.254','::ffff:a9fe:a9fe'])('rejects mapped link-local even in dev %s',ip=>{
  expect(()=>parseWebUrl(`http://[${ip}]/`,{allowPrivate:true,allowHttp:true})).toThrow(/fetchable/);
 });
});
