import { afterEach, expect, it, vi } from 'vitest';
import { runnerConfig } from '../src/config';
import { hostCapabilities } from '../src/capabilities';
import type { CapabilityContext } from '../src/local';

const context = (): CapabilityContext => ({runId:'output-limit',request:{userId:'mxmx_test_runner',requestId:'output-limit',program:{source:'',language:'javascript'},input:null},signal:new AbortController().signal,requests:[],usage:[]});
const response = () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
afterEach(() => vi.unstubAllGlobals());

it.each(['max_tokens', 'max_completion_tokens'] as const)('forwards a bounded explicit output limit using %s only', async field => {
  const fetcher=vi.fn(async(_url:unknown,_init:RequestInit)=>response()); vi.stubGlobal('fetch',fetcher);
  const call=hostCapabilities({artifactbin:async()=>null,ai:{baseUrl:'http://fixture/v1',models:['fixture'],defaultModel:'fixture',outputTokenField:field,maxOutputTokens:8192}});
  await call(context(),'ai.open',{maxOutputTokens:4096,context:{messages:[]}});
  const body=JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
  expect(body[field]).toBe(4096);
  expect(body[field==='max_tokens'?'max_completion_tokens':'max_tokens']).toBeUndefined();
});

it('uses the host limit when the caller omits it and clamps a larger requested limit', async()=>{
  const bodies: Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',vi.fn(async(_url:unknown,init:RequestInit)=>{bodies.push(JSON.parse(String(init.body)));return response();}));
  const call=hostCapabilities({artifactbin:async()=>null,ai:{baseUrl:'http://fixture/v1',models:['fixture'],defaultModel:'fixture',outputTokenField:'max_tokens',maxOutputTokens:8192}});
  await call(context(),'ai.open',{context:{messages:[]}});
  await call(context(),'ai.open',{maxOutputTokens:100000,context:{messages:[]}});
  expect(bodies.map(body=>body.max_tokens)).toEqual([8192,8192]);
});

it.each([0,-1,1.5,'4096',null])('rejects invalid caller output cap %s before contacting the provider',async value=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  const call=hostCapabilities({artifactbin:async()=>null,ai:{baseUrl:'http://fixture/v1',models:['fixture'],defaultModel:'fixture'}});
  await expect(call(context(),'ai.open',{maxOutputTokens:value,context:{messages:[]}})).rejects.toThrow('invalid_ai_output_limit');
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects unsupported provider dialect and invalid host limits at startup',()=>{
  const ai={baseUrl:'http://fixture/v1',models:['fixture'],defaultModel:'fixture'};
  expect(()=>hostCapabilities({artifactbin:async()=>null,ai:{...ai,outputTokenField:'guess' as never}})).toThrow('invalid_ai_output_token_field');
  expect(()=>hostCapabilities({artifactbin:async()=>null,ai:{...ai,maxOutputTokens:0}})).toThrow('invalid_ai_output_limit');
});

it('reads the provider limit through audited runner configuration',()=>{
  const config=runnerConfig({RUNNER__OPENAI_BASE_URL:'http://fixture/v1',RUNNER__MODEL:'fixture',RUNNER__OUTPUT_TOKEN_FIELD:'max_tokens',RUNNER__MAX_OUTPUT_TOKENS:'16384'});
  expect(config.ai).toMatchObject({outputTokenField:'max_tokens',maxOutputTokens:16384});
  expect(()=>runnerConfig({RUNNER__OUTPUT_TOKEN_FIELD:'guess'})).toThrow('invalid_ai_output_token_field');
  expect(()=>runnerConfig({RUNNER__MAX_OUTPUT_TOKENS:'-1'})).toThrow('invalid_ai_output_limit');
});
