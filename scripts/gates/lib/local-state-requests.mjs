/**
 * The local-state gate observes every frame and parent request. Its sole
 * independent transport is the reader shell's ephemeral presence heartbeat.
 * @typedef {{url:string,method:string,mainFrame:boolean,body:unknown}} ObservedRequest
 * @typedef {{origin:string,artifactId:string,revision:string}} PresenceFixture
 */
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const nodeId=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const cursor=value=>value===null||exact(value,['nodeId','x','y'])&&nodeId(value.nodeId)&&Number.isFinite(value.x)&&value.x>=0&&value.x<=1&&Number.isFinite(value.y)&&value.y>=0&&value.y<=1;
const selection=value=>value===null||Array.isArray(value)&&value.length>0&&value.length<=8&&value.every(range=>exact(range,['nodeId','start','end','length','fingerprint'])&&nodeId(range.nodeId)&&Number.isInteger(range.start)&&Number.isInteger(range.end)&&Number.isInteger(range.length)&&range.start>=0&&range.end>range.start&&range.end<=range.length&&range.length<=100000&&typeof range.fingerprint==='string'&&/^[a-f0-9]{8}$/.test(range.fingerprint));
/** @param {ObservedRequest} request @param {PresenceFixture} fixture */
export function isReaderPresenceRequest(request,fixture){
 if(!request.mainFrame||request.method!=='POST')return false;
 let url;try{url=new URL(request.url);}catch{return false;}
 if(url.origin!==fixture.origin||url.pathname!==`/api/artifacts/${fixture.artifactId}/presence`||url.search||url.hash)return false;
 const body=request.body;
 return exact(body,['session','revision','visible','cursor','selection'])&&typeof body.session==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(body.session)&&body.revision===fixture.revision&&typeof body.visible==='boolean'&&cursor(body.cursor)&&selection(body.selection);
}
