/** Gate-only delivery sink. Real Better Auth/OTP/session code still runs. */
import {appendFileSync} from 'node:fs';

if (!['artifactbin.test','127.0.0.1.nip.io'].includes(new URL(process.env.APP__PUBLIC_BASE_URL).hostname)
    || process.env.EMAIL__RESEND_API_KEY !== 'mxmx_test_controls_mail'
    || !process.env.EMAIL__DEV_OUTBOX_PATH) throw new Error('Controls mail fixture requires its isolated test configuration');
const originalFetch=globalThis.fetch;
globalThis.fetch=async (input,init) => {
  const url=input instanceof Request ? input.url : String(input);
  if (url!=='https://api.resend.com/emails') return originalFetch(input,init);
  if (init?.method!=='POST') throw new Error('Unexpected mail fixture method');
  const mail=JSON.parse(init.body);
  if (!Array.isArray(mail.to) || mail.to.length!==1 || !/^mxmx_test_.*@example\.com$/.test(mail.to[0])) throw new Error('Unexpected mail fixture recipient');
  appendFileSync(process.env.EMAIL__DEV_OUTBOX_PATH,JSON.stringify({...mail,to:mail.to[0]})+'\n',{mode:0o600});
  return Response.json({id:'mxmx_test_controls_mail'});
};
