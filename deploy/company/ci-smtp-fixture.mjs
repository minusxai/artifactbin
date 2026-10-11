/** CI-only local TLS SMTP sink; never forwards mail or prints received messages. */
import {createRequire} from 'node:module';
import {readFileSync,appendFileSync} from 'node:fs';
const {SMTPServer}=createRequire(import.meta.url)('/smtp/node_modules/smtp-server');
const server=new SMTPServer({
 key:readFileSync('/fixture/key.pem'),cert:readFileSync('/fixture/cert.pem'),secure:false,
 onAuth(auth,_session,callback){callback(auth.username==='fixture-user'&&auth.password==='fixture-password'?null:Error('Fixture authentication failed'),{user:'fixture-user'});},
 onData(stream,session,callback){let body='';stream.setEncoding('utf8');stream.on('data',chunk=>{body+=chunk;});stream.on('error',callback);stream.on('end',()=>{appendFileSync('/fixture/messages.jsonl',JSON.stringify({to:session.envelope.rcptTo.map(recipient=>recipient.address),body})+'\n');callback();});},
});
server.on('error',()=>{console.error('CI SMTP fixture failed');process.exitCode=1;});
server.listen(2525,'0.0.0.0');
