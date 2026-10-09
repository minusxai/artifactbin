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
// THE PAGE IS THE DOCUMENT. The app page frames every document on the document's own origin
// (lib/serving/document-frame: iframe[data-mx-document-frame], name "mx-document"), and window.page lives
// inside that frame. So on a page that frames a document, what a script reads, waits for, locates and acts
// on resolves in the frame; page.url(), goto, screenshot, keyboard and mouse stay the app page's.
const DOCUMENT_FRAME = 'iframe[data-mx-document-frame]';
const documentFrame = page => page.mainFrame().childFrames().find(frame => frame.name() === 'mx-document');
// Loaded at the document's origin and booted (lib/islands/frame-bridge: no page data, or ready).
const settled = () => {
  const html = document.documentElement;
  return /^https?:$/.test(location.protocol) && !!html && !html.hasAttribute('data-mx-session-redirect') && document.readyState !== 'loading'
    && (!document.getElementById('mx-story-data') || html.hasAttribute('data-mx-ready'));
};
const target = async page => {
  const frame = documentFrame(page);
  if (!frame) return page.mainFrame();
  await frame.waitForFunction(settled);
  return frame;
};
const IN_DOCUMENT = ['evaluate','evaluateHandle','waitForFunction','$','$$','$eval','$$eval','waitForSelector','content','addScriptTag','addStyleTag',
  'click','dblclick','tap','fill','type','press','check','uncheck','setChecked','hover','focus','selectOption','setInputFiles','dispatchEvent','dragAndDrop',
  'textContent','innerText','innerHTML','getAttribute','inputValue','isChecked','isDisabled','isEditable','isEnabled','isHidden','isVisible'];
const LOCATED_IN_DOCUMENT = ['locator','getByRole','getByText','getByLabel','getByPlaceholder','getByAltText','getByTitle','getByTestId','frameLocator'];
const documentScoped = page => {
  for (const name of IN_DOCUMENT) page[name] = async (...args) => (await target(page))[name](...args);
  // Locators re-resolve the frame on every use, so one made before the document settled still finds it.
  for (const name of LOCATED_IN_DOCUMENT) page[name] = (...args) => (documentFrame(page) ? page.mainFrame().frameLocator(DOCUMENT_FRAME) : page.mainFrame())[name](...args);
};
// A redirect to another of the session's origins comes back unfollowed (src/session-redirects): a routed
// request's redirect is never routed again, so the page navigates there itself and the next request is routed.
const navigateTo = href => '<!doctype html><html data-mx-session-redirect><script>location.replace(' + JSON.stringify(href).replace(/</g, '\\u003c') + ')</script></html>';
// DIE WITH THE PARENT. Under bubblewrap --die-with-parent does this; a worker started
// as a plain child (BROWSER__SANDBOX=none) has no such flag, and Chromium keeps the
// event loop alive forever — a dev server stopped with the browser open left orphaned
// browsers on the machine. The control pipe closing IS the parent going away.
readline.createInterface({input:process.stdin}).on('close', () => process.exit(0)).on('line', async line => {
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
      const args = message.args;
      if (args !== undefined && (!Array.isArray(args) || !args.every(arg => typeof arg === 'string' && /^--host-resolver-rules=[A-Za-z0-9.*, -]+$/.test(arg)))) throw new Error('Invalid session browser arguments');
      browser = await chromium.launch({headless:true,...(args ? {args} : {}),...(executablePath ? {executablePath} : {})});
      browser.on('disconnected', () => process.exit(1));
      context = await browser.newContext({baseURL:message.baseURL,serviceWorkers:'block',acceptDownloads:false});
      context.setDefaultTimeout(5000); context.setDefaultNavigationTimeout(10000);
      await context.route('**/*', async route => {
        try {
          const request = route.request();
          const result = await rpc({url:request.url(), method:request.method(), headers:request.headers(), body:request.postDataBuffer()?.toString('base64')});
          const location = result.status >= 300 && result.status < 400 ? result.headers.location : undefined;
          if (location) {
            if (!request.isNavigationRequest()) { await route.abort(); return; }
            await route.fulfill({status:200,contentType:'text/html',body:navigateTo(new URL(location, request.url()).href)});
            return;
          }
          await route.fulfill({status:result.status,headers:result.headers,body:Buffer.from(result.body,'base64')});
        } catch { await route.abort().catch(() => {}); }
      });
      context.on('page', page => {
        if (pages.size >= 8) { void page.close(); return; }
        documentScoped(page);
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
