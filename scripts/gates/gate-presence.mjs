/** Native presence: two accounts, a guest and two tabs of one session. The latter must not exhaust HTTP/1 sockets. */
import {connectAgent} from './lib/account-connection.mjs';
import {mergeGuestIntoAccount} from '../lib/start-doc.mjs';
import {launchChromium} from './lib/browser.mjs';
import {documentFrame} from './lib/page-facts.mjs';
import {openArtifactControls} from './lib/reveal-chrome.mjs';
import {createChecker} from './lib/assert.mjs';
import {startMailSink,loginViaEmail} from '../lib/mail-login.mjs';
const BASE=process.argv[2]??'http://localhost:3030',check=createChecker('presence');
const browser=await launchChromium(),sink=await startMailSink(),stamp=Date.now().toString(36);
const contexts=await Promise.all([0,1,2].map(()=>browser.newContext({viewport:{width:1200,height:900}})));
const [owner,other,guest]=await Promise.all(contexts.map(c=>c.newPage()));
const publicIds=new Map();let ownerCursorAcks=0,presenceStreams=0;
function observe(page){page.on('response',response=>{
 if(!response.url().endsWith('/presence'))return;
 if(response.request().method()==='GET'){presenceStreams++;return;}
 if(response.status()!==200)return;
 void response.json().then(body=>publicIds.set(page,body.id));
 if(page===owner&&response.request().postDataJSON()?.cursor)ownerCursorAcks++;
});}
[owner,other,guest].forEach(observe);
const until=async(read,want,budget=12000)=>{const end=Date.now()+budget;let value;do{value=await read();if(want(value))return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);return value;};
const frame=async page=>{await page.locator('iframe[data-mx-document-frame]').waitFor();const target=await documentFrame(page);await target.locator('[data-af-id="words"]').waitFor();return target;};
const setPreference=async(page,label)=>{await openArtifactControls(page);await page.getByRole('button',{name:/^Readers ·/}).click();await page.getByRole('switch',{name:label,exact:true}).click();await page.keyboard.press('Escape');await page.locator('[aria-label="Dismiss artifact controls"]').click();};
// Assert rendered unique counts through the real controls, not a duplicate of the model.
const readers=async(page,total,label)=>{
 await openArtifactControls(page);
 const button=page.getByRole('button',{name:/^Readers ·/});
 check(await until(()=>button.getAttribute('aria-label'),name=>name===`Readers · ${total}`,20000)===`Readers · ${total}`,label);
 await page.locator('[aria-label="Dismiss artifact controls"]').click();
};
const move=async page=>{const target=await frame(page);const box=await target.locator('[data-af-id="words"]').boundingBox();await page.mouse.move(box.x+20,box.y+10);await page.mouse.move(box.x+70,box.y+10);};
const select=async target=>target.locator('[data-af-id="words"]').evaluate(node=>{const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
try{
 const email=`mxmx_test_presence_owner_${stamp}@example.com`;
 await Promise.all([loginViaEmail(owner,BASE,sink,email),loginViaEmail(other,BASE,sink,`mxmx_test_presence_peer_${stamp}@example.com`)]);
 const connection=await connectAgent(BASE,{email});
 if(await mergeGuestIntoAccount(owner,BASE,connection.token)!==200)throw new Error('Owner connection adoption failed');
 const published=await fetch(`${BASE}/api/artifacts`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${connection.token}`},body:JSON.stringify({visibility:'public',html:'<!doctype html><html><head><title>Presence proof</title><script data-af="core" src="/af/core.js"></script></head><body style="padding:80px;font:20px sans-serif"><p data-af-id="words">Shared reader selection stays native.</p><input data-af-id="private" value="viewer secret"></body></html>'})});
 if(!published.ok)throw new Error(`publish ${published.status}`);const doc=await published.json();
 await Promise.all([owner,other,guest].map(page=>page.goto(`${BASE}/a/${doc.id}`,{waitUntil:'load'})));
 const [ownFrame,peerFrame,guestFrame]=await Promise.all([owner,other,guest].map(frame));
 check(await until(()=>ownFrame.locator('[data-af="presence-overlay"]').count(),n=>n===1)===1,'owner native bridge installed presence');
 await move(owner);await select(ownFrame);
 check(await until(()=>peerFrame.locator('[data-af-presence-cursor]').count(),n=>n>0)>0,'second account sees the first reader cursor');
 check(await until(()=>peerFrame.locator('[data-af-presence-selection]').count(),n=>n>0)>0,'second account sees exact native text selection');
 check(await ownFrame.evaluate(()=>getSelection().toString())==='Shared reader selection stays native.','remote overlays preserve sender native selection');
 // Signed-out readers get no presence (#1165): the owner's cursor and selection never reach the guest.
 await new Promise(r=>setTimeout(r,1500));
 check(await guestFrame.locator('[data-af-presence-cursor],[data-af-presence-selection]').count()===0,'a signed-out reader receives no presence');
 await setPreference(other,'Show other cursors');
 check(await until(()=>peerFrame.locator('[data-af-presence-cursor]').count(),n=>n===0)===0,'reader hides cursors independently');
 check(await peerFrame.locator('[data-af-presence-selection]').count()>0,'hiding cursors retains other selections');
 await other.reload({waitUntil:'load'});const peerReload=await frame(other);
 await openArtifactControls(other);await other.getByRole('button',{name:/^Readers ·/}).click();check(await other.getByRole('switch',{name:'Show other cursors',exact:true}).getAttribute('aria-checked')==='false','private reader preferences survive reload');await other.keyboard.press('Escape');await other.locator('[aria-label="Dismiss artifact controls"]').click();
 await setPreference(owner,'Share my selections');
 check(await until(()=>peerReload.locator('[data-af-presence-selection]').count(),n=>n===0)===0,'sender stops sharing selection without clearing native selection');
 check(await ownFrame.evaluate(()=>getSelection().toString())==='Shared reader selection stays native.','sharing preference preserves selected text');
 await setPreference(owner,'Share my selections');await move(owner);await select(ownFrame);
 const same=await contexts[0].newPage();observe(same);await same.goto(`${BASE}/a/${doc.id}`,{waitUntil:'load'});const sameFrame=await frame(same);
 await until(()=>Promise.resolve(publicIds.has(same)),Boolean);
 await readers(same,2,'same account is excluded from other readers across tabs');
 const third=await contexts[0].newPage();observe(third);
 // Extra fixture tabs do not need the unrelated account-notification stream. Keep the existing two-tab socket check isolated.
 await third.route('**/api/my/people/events',route=>route.abort());
 await third.goto(`${BASE}/a/${doc.id}`,{waitUntil:'load'});await frame(third);await until(()=>Promise.resolve(publicIds.has(third)),Boolean);
 check(publicIds.has(third),'third own-account tab really published a distinct live session');
 await readers(owner,2,'three own-account tabs add zero other readers');
 const peerTabs=await Promise.all([0,1].map(()=>contexts[1].newPage()));
 for(const tab of peerTabs){observe(tab);await tab.route('**/api/my/people/events',route=>route.abort());await tab.goto(`${BASE}/a/${doc.id}`,{waitUntil:'load'});await frame(tab);await until(()=>Promise.resolve(publicIds.has(tab)),Boolean);check(publicIds.has(tab),'peer tab really published its own live session');}
 await readers(owner,2,'three peer-account tabs count as one other reader');
 check(/^[a-f0-9]{64}$/.test(publicIds.get(same))&&publicIds.get(same)!==publicIds.get(owner),'same account windows receive distinct server presence IDs');
 await third.close();for(const tab of peerTabs)await tab.close();
 await owner.bringToFront();await ownFrame.locator('[data-af-id="words"]').click();const beforeAck=ownerCursorAcks;await move(owner);
 check(await until(()=>Promise.resolve(ownerCursorAcks),n=>n>beforeAck)>beforeAck,'two tabs leave HTTP connections available for fresh cursor publication');
 check(await until(()=>sameFrame.locator('[data-af-presence-cursor]').count(),n=>n>0)>0,'another window of the same account sees the live cursor');
 await setPreference(owner,'Show me to other readers');
 check(await until(()=>sameFrame.locator('[data-af-presence-cursor]').count(),n=>n===0)===0,'hidden reader clears their live cursor');
 check(await until(()=>sameFrame.locator('[data-af-presence-selection]').count(),n=>n===0)===0,'hidden reader clears their live text selection');
 await readers(owner,2,'hidden self still excludes its other visible tabs');
 await move(guest);
 check(await peerReload.locator('[data-af-presence-cursor]').count()===0,'receiver cursor preference stays hidden for anonymous senders');
 check(await until(()=>sameFrame.locator('[data-af-presence-cursor]').count(),n=>n>0)>0,'anonymous reader can share a cursor without account credentials');
 // Stop peer publications without a departure. Counts must expire from idle room timers.
 for(const tab of [other])await tab.route('**/api/artifacts/*/presence',route=>route.abort());
 await openArtifactControls(owner);
 const readerButton=owner.getByRole('button',{name:/^Readers ·/});
 await owner.waitForFunction(()=>{const roots=[document];for(let i=0;i<roots.length;i++)for(const el of roots[i].querySelectorAll('*'))if(el.shadowRoot)roots.push(el.shadowRoot);return roots.some(root=>root.querySelector('button[aria-label="Readers · 1"]'));},null,{timeout:50_000});
 check(await readerButton.getAttribute('aria-label')==='Readers · 1','peer account expires without geometry or count activity');
 await owner.locator('[aria-label="Dismiss artifact controls"]').click();
 for(const tab of [other])await tab.unroute('**/api/artifacts/*/presence');
 await other.reload({waitUntil:'load'});await frame(other);
 await readers(owner,2,'reload and reconnect converge to one peer account again');
 check(presenceStreams===0,'presence shares the existing document stream instead of opening another SSE connection');
}finally{await browser.close();await sink.close();}
check.done();
