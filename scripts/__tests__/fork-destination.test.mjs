import {it,expect} from 'vitest';
import {forkDestination} from '../gates/lib/fork-destination.mjs';

it('identifies the actual copy across direct and Welcome navigation without reading an unloading response body',()=>{
 const copy='/@new-owner/def456-a-new-title';
 expect(forkDestination(new URL(copy,'https://app.example.test'),'abc123')).toEqual({id:'def456',path:copy});
 expect(forkDestination(new URL('/welcome?callbackUrl='+encodeURIComponent(copy),'https://app.example.test'),'abc123')).toEqual({id:'def456',path:copy});
 expect(forkDestination(new URL('/a/def456','https://app.example.test'),'abc123')).toEqual({id:'def456',path:'/a/def456'});
});
it('waits through login, the source, missing callbacks and refuses foreign or malformed destinations',()=>{
 for(const path of ['/login','/a/abc123','/@owner/abc123-original','/welcome','/welcome?callbackUrl=%2Fa%2Fabc123','/welcome?callbackUrl=https%3A%2F%2Fforeign.example%2Fa%2Fdef456','/welcome?callbackUrl=%2F%2Fforeign.example%2Fa%2Fdef456','/welcome?callbackUrl=%2Fa%2Fbad','/welcome?callbackUrl=http%3A%2F%2F%5Binvalid']){
  expect(forkDestination(new URL(path,'https://app.example.test'),'abc123'),path).toBeNull();
 }
});
