import {beforeEach,describe,expect,it,vi} from 'vitest';
import {resolvePostgresHost} from '../network';
const dns=vi.hoisted(()=>({lookup:vi.fn(),resolve4:vi.fn(),resolve6:vi.fn(),setServers:vi.fn(),cancel:vi.fn(),construct:vi.fn()}));
vi.mock('node:dns/promises',()=>({lookup:dns.lookup,Resolver:class{constructor(...args:unknown[]){dns.construct(...args);}setServers=dns.setServers;resolve4=dns.resolve4;resolve6=dns.resolve6;cancel=dns.cancel;}}));
beforeEach(()=>{vi.clearAllMocks();dns.lookup.mockResolvedValue([{address:'10.0.0.7',family:4}]);dns.resolve4.mockResolvedValue(['8.8.4.4']);dns.resolve6.mockResolvedValue(['2606:4700:4700::1111']);});
describe('dataset-specific operator DNS',()=>{
 it('uses only the selected resolvers, checks both families and pins the public answer',async()=>{
  expect(await resolvePostgresHost('db.example.com',false,['1.1.1.1'])).toBe('8.8.4.4');
  expect(dns.setServers).toHaveBeenCalledWith(['1.1.1.1']);expect(dns.resolve4).toHaveBeenCalledWith('db.example.com');expect(dns.resolve6).toHaveBeenCalledWith('db.example.com');expect(dns.lookup).not.toHaveBeenCalled();
 });
 it('retains system resolution and refusal when the override is absent',async()=>{
  await expect(resolvePostgresHost('db.example.com')).rejects.toThrow(/not permitted/);expect(dns.lookup).toHaveBeenCalledOnce();expect(dns.construct).not.toHaveBeenCalled();
 });
 it('rejects a private answer in the other family instead of picking only the public A record',async()=>{
  dns.resolve6.mockResolvedValue(['::ffff:a00:1']);await expect(resolvePostgresHost('db.example.com',false,['1.1.1.1'])).rejects.toThrow(/not permitted/);expect(dns.resolve6).toHaveBeenCalledOnce();expect(dns.lookup).not.toHaveBeenCalled();
 });
 it('accepts an absent address family, but never falls back after resolver failure',async()=>{
  dns.resolve6.mockRejectedValue(Object.assign(new Error('internal detail'),{code:'ENODATA'}));expect(await resolvePostgresHost('db.example.com',false,['1.1.1.1'])).toBe('8.8.4.4');
  dns.resolve6.mockRejectedValue(Object.assign(new Error('resolver secret detail'),{code:'ETIMEOUT'}));await expect(resolvePostgresHost('db.example.com',false,['1.1.1.1'])).rejects.toThrow('PostgreSQL host could not be resolved.');expect(dns.lookup).not.toHaveBeenCalled();
 });
 it('bypasses custom DNS for literals and still refuses metadata even with private access enabled',async()=>{
  expect(await resolvePostgresHost('8.8.8.8',false,['1.1.1.1'])).toBe('8.8.8.8');await expect(resolvePostgresHost('169.254.169.254',true,['1.1.1.1'])).rejects.toThrow(/not permitted/);expect(dns.construct).not.toHaveBeenCalled();
 });
});
