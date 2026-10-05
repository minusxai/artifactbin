import { expect, it, vi } from 'vitest';
import { resolveHostedAgent } from '../host';
import type { AppHostOptions } from '../host';

const context={} as Parameters<NonNullable<AppHostOptions['hostedAgent']>>[0];
it('leaves managed agents disabled without an explicit deployment or URL', async()=>{
 expect(await resolveHostedAgent({},context)).toBeUndefined();
});
it('injects a deployment implementation without interpreting its provider settings',async()=>{
 const installed={agent:{} as never,tick:async()=>{},close:async()=>{}};
 const factory=vi.fn(async()=>installed);
 expect(await resolveHostedAgent({factory},context)).toBe(installed);
 expect(factory).toHaveBeenCalledWith(context);
});
it('requires authentication for configured services and never silently falls back',async()=>{
 const factory=vi.fn(async()=>({agent:{} as never,tick:async()=>{}}));
 await expect(resolveHostedAgent({url:'https://service.test',factory},context)).rejects.toThrow('CONTRACT__ACTOR_SECRET');
 expect(factory).not.toHaveBeenCalled();
 expect(await resolveHostedAgent({url:'https://service.test',secret:'fixture-only-secret',factory},context)).toHaveProperty('agent');
 expect(factory).not.toHaveBeenCalled();
});
