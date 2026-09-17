/** Self-contained child module: imports resolve only inside the private worker directory. */
export const SESSION_WORKER_SOURCE = String.raw`
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
let context, browser;
const pages = new Map(), requests = new Map();
let sequence = 0;
const write = process.stdout.write.bind(process.stdout);
const send = value => write(JSON.stringify(value)+'\n');
console.log = (...values) => process.stderr.write(values.map(String).join(' ')+'\n');
const rpc = payload => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { requests.delete(id); reject(new Error('Request deadline exceeded')); }, 10000);
  requests.set(id, {resolve, reject, timer}); send({type:'fetch', id, ...payload});
});
// The raw URL only: artifact identity is derived on the trusted side (src/sessions.ts) from the
// shared reference grammar, so the sandbox never carries a second copy of it.
const pageList = () => [...pages].filter(([,page]) => !page.isClosed()).map(([page_id,page]) => ({page_id,url:page.url()}));
readline.createInterface({input:process.stdin}).on('line', async line => {
  const message = JSON.parse(line);
  if (message.type === 'fetched') {
    const task = requests.get(message.id); if (!task) return;
    requests.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error)); else task.resolve(message);
    return;
  }
  if (message.type === 'init') {
    try {
      const executablePath = message.executablePath;
      if (executablePath !== undefined && (typeof executablePath !== 'string' || !/^\/browsers\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(executablePath))) throw new Error('Invalid session browser executable');
      browser = await chromium.launch({headless:true,...(executablePath ? {executablePath} : {})});
      browser.on('disconnected', () => process.exit(1));
      context = await browser.newContext({baseURL:message.baseURL,serviceWorkers:'block',acceptDownloads:false});
      context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(10000);
      await context.route('**/*', async route => {
        try {
          const request = route.request();
          const result = await rpc({url:request.url(), method:request.method(), headers:request.headers(), body:request.postDataBuffer()?.toString('base64')});
          await route.fulfill({status:result.status,headers:result.headers,body:Buffer.from(result.body,'base64')});
        } catch { await route.abort().catch(() => {}); }
      });
      context.on('page', page => {
        if (pages.size >= 8) { void page.close(); return; }
        const id = randomUUID(); pages.set(id,page);
        page.on('close', () => pages.delete(id));
      });
      send({type:'ready'});
    } catch (error) { send({type:'fatal',error:String(error.message).slice(0,500)}); }
    return;
  }
  if (message.type !== 'run') return;
  const attachments = [];
  let bytes = 0;
  const output = Object.freeze({image: async value => {
    const buffer = Buffer.from(value);
    bytes += buffer.length;
    if (bytes > 5 * 1024 * 1024) throw new Error('Image output limit exceeded');
    const png = buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = buffer[0]===255 && buffer[1]===216;
    if (!png && !jpeg) throw new Error('Expected PNG or JPEG bytes');
    attachments.push({mime:png?'image/png':'image/jpeg',base64:buffer.toString('base64')});
    return {attachment:attachments.length-1};
  }});
  try {
    const fn = Object.getPrototypeOf(async function(){}).constructor('context','pages','output','"use strict";\n'+message.code);
    const value = await fn(context,Object.freeze(Object.fromEntries(pages)),output);
    const result = JSON.parse(JSON.stringify(value === undefined ? null : value));
    send({type:'result',value:{result,pages:pageList(),attachments}});
  } catch (error) {
    send({type:'result',value:{pages:pageList(),attachments,error:{code:String(error.code || 'SCRIPT_ERROR'),message:String(error.message).slice(0,1000)}}});
  }
});
send({type:'hello'});
`;
