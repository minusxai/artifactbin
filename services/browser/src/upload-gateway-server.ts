/**
 * THE EXPORT UPLOAD GATEWAY, a process of its own. The browser service has no egress network; this joins the compute
 * and egress networks, publishes no port, and lets through only bounded PNG and JPEG PUTs to the one configured
 * origin and prefix (`BROWSER__UPLOAD_ORIGIN`, `BROWSER__UPLOAD_PREFIX`), streaming bytes, stripping other headers and
 * following no redirect (./upload-gateway). It holds no S3 credentials: the app's signed URL is the grant. The
 * restriction lives here, not in a VPC firewall. The 30-second export budget covers queue, startup, readiness,
 * capture and upload; a failed refresh keeps the prior object (lib/export in the app).
 */
import {createServer} from 'node:http';
import {createEnv,log} from '@artifactbin/utils';
import {browserUploadOptions} from './upload-config';
import {uploadGateway} from './upload-gateway';
const options=browserUploadOptions(process.env);
if(!options)throw new Error('Upload gateway requires BROWSER__UPLOAD_ORIGIN and BROWSER__UPLOAD_PREFIX');
const {env}=createEnv(process.env),port=Number(env('APP','PORT')??'8080');
const server=createServer(uploadGateway(options));
server.requestTimeout=20_000;server.headersTimeout=5_000;
server.listen(port,'0.0.0.0',()=>log('upload-gateway').info(`listening on ${port}`));
