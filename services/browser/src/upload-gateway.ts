import {request as httpRequest,type RequestListener} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {admittedUploadUrl,MAX_EXPORT_BYTES,type UploadOptions} from './upload';
/** No arbitrary forward proxy: one destination, one prefix, PUT only, bounded streaming. */
export function uploadGateway(options:Pick<UploadOptions,'origin'|'prefix'>):RequestListener {
 return (req,res)=>{
  if(req.method==='GET'&&req.url==='/health'){res.end('ok');return;}
  let url:URL;
  const size=Number(req.headers['content-length']),type=req.headers['content-type'];
  try {
   if(req.method!=='PUT'||req.headers['x-upload-origin']!==options.origin||!req.url?.startsWith('/')
    ||!Number.isSafeInteger(size)||size<1||size>MAX_EXPORT_BYTES||!['image/png','image/jpeg'].includes(type??''))throw new Error('refused');
   url=admittedUploadUrl(new URL(req.url,options.origin).toString(),options);
  }catch{res.writeHead(403);res.end();return;}
  const upstream=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'PUT',headers:{'content-type':type!,'content-length':size}},answer=>{
   answer.resume();res.writeHead(answer.statusCode&&answer.statusCode>=200&&answer.statusCode<300?200:502);res.end();
  });
  const timer=setTimeout(()=>upstream.destroy(new Error('Upload deadline')),15_000);
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  upstream.on('close',()=>clearTimeout(timer));
  req.on('aborted',()=>upstream.destroy());
  res.on('close',()=>{if(!res.writableFinished)upstream.destroy();});
  req.pipe(upstream);
 };
}
