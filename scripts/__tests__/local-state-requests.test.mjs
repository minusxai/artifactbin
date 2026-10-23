import {expect,it} from 'vitest';
import {isReaderPresenceRequest} from '../gates/lib/local-state-requests.mjs';
const fixture={origin:'http://app.example.test:3030',artifactId:'Page123',revision:'2'};
const request={url:fixture.origin+'/api/artifacts/Page123/presence',method:'POST',mainFrame:true,body:{session:'6e65f518-b04d-4eba-9c71-fd204818c9ad',revision:'2',visible:true,cursor:null,selection:null}};
it('separates only the parent presence heartbeat with its bounded geometry payload',()=>{
 expect(isReaderPresenceRequest(request,fixture)).toBe(true);
 expect(isReaderPresenceRequest({...request,body:{...request.body,cursor:{nodeId:'af-1',x:.3,y:1},selection:[{nodeId:'af-2',start:0,end:3,length:10,fingerprint:'1234abcd'}]}},fixture)).toBe(true);
});
it('counts authored-frame requests and parent GraphQL relays as local-state network activity',()=>{
 expect(isReaderPresenceRequest({...request,mainFrame:false},fixture)).toBe(false);
 expect(isReaderPresenceRequest({...request,url:fixture.origin+'/api/artifacts/Page123/graphql',body:{query:'{sales{rows{rows{id}}}}'}},fixture)).toBe(false);
});
it.each([
 {url:'http://other.example.test:3030/api/artifacts/Page123/presence'},
 {url:fixture.origin+'/api/artifacts/Other123/presence'},
 {url:request.url+'/extra'}, {url:request.url+'?day=9'}, {url:request.url+'#state'},
 {method:'GET'}, {body:{...request.body,session:'------------------------------------'}}, {body:{...request.body,day:'Day 9'}},
 {body:{...request.body,revision:'1'}}, {body:{...request.body,session:'local draft'}},
 {body:{...request.body,cursor:{nodeId:'af-1',x:2,y:0}}},
 {body:{...request.body,cursor:{nodeId:'af-1',x:0,y:0,day:'Day 9'}}},
 {body:{...request.body,selection:[{nodeId:'af-1',start:0,end:3,length:2,fingerprint:'1234abcd'}]}},
])('counts spoofed paths and state-bearing or malformed presence payloads (%j)',change=>{
 expect(isReaderPresenceRequest({...request,...change},fixture)).toBe(false);
});
