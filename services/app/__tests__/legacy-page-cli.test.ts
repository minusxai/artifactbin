import {expect,it,vi} from 'vitest';
import {LiveRegionRefusal} from '@/lib/live-regions';
const mocks=vi.hoisted(()=>({migrate:vi.fn(),close:vi.fn()}));
vi.mock('@/lib/artifacts',()=>({migrateLegacyPage:mocks.migrate}));
vi.mock('@/lib/platform',()=>({getDb:async()=>({close:mocks.close})}));

it('reports only fixed aggregate refusal categories, never exception details or IDs',async()=>{
 const argv=process.argv,exitCode=process.exitCode;
 const log=vi.spyOn(console,'log').mockImplementation(()=>{});
 mocks.migrate.mockResolvedValueOnce('eligible')
  .mockRejectedValueOnce(new LiveRegionRefusal('unsupported_content',['legacy checkbox attributes']))
  .mockRejectedValueOnce(new LiveRegionRefusal('unsupported_content',['attribute synthetic-private-name']))
  .mockRejectedValueOnce(new Error('synthetic-private-source'));
 process.argv=['node','migration','synthetic-id-1','synthetic-id-2','synthetic-id-3','synthetic-id-4'];
 try{
  await import('../scripts/migrate-legacy-pages');
  expect(log).toHaveBeenCalledWith(JSON.stringify({apply:false,counts:{eligible:1,refused:3},refusals:{unsupported_content:2,unexpected_error:1}}));
  expect(process.exitCode).toBe(1);
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.migrate).toHaveBeenCalledWith('synthetic-id-2',{apply:false});
 }finally{process.argv=argv;process.exitCode=exitCode;log.mockRestore();}
});
