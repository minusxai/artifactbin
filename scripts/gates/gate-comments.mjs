/** Native comment journeys. Source-editing toolbar/autosave checks are retired with that product.
 * Compiler For/DataTable coordinates are replaced by ordinary DOM identities; discussion chrome remains original.
 * Markdown rendering and mobile folding measurements below are retained from the original gate. */
import {sleep} from './lib/sleep.mjs';
import {createChecker} from './lib/assert.mjs';
import {fixtureFetch as fetch} from './lib/fixture-http.mjs';
import {launchChromium} from './lib/browser.mjs';
import {openArtifactControls} from './lib/reveal-chrome.mjs';
import {documentLocator,documentFrame,DOCUMENT_FRAME} from './lib/page-facts.mjs';
import {becomeOwner} from '../lib/start-doc.mjs';
import {connectAgent} from './lib/cli-connection.mjs';
import {expect} from 'playwright/test';
import sharp from 'sharp';
const BASE=process.argv[2]??'http://localhost:3030';
const check=createChecker('comments');
async function until(read,want,budgetMs=10000){const deadline=Date.now()+budgetMs;let last;while(Date.now()<deadline){last=await read().catch(()=>undefined);if(want(last))return last;await sleep(100);}return last;}
const dismissControls=async(page)=>{await page.keyboard.press('Escape');await page.evaluate(()=>document.activeElement?.blur?.());};
const html=(content)=>`<!doctype html><html><head><title>Comment gate</title></head><body style="font:18px/1.6 sans-serif;padding:40px;max-width:900px">${content}</body></html>`;
const DOC=html('<h1>Quarterly report</h1><section data-af-id="section"><p id="figure" data-af-id="figure">Revenue grew 40% in Q3.</p><ul id="list" data-af-id="list"><li>one</li><li>two</li></ul></section>');
const CAP_DOC=html('<h1>The cap</h1><p id="cap" data-af-id="cap">The cap is 5 today.</p>');
async function publish(source){const {token}=await connectAgent(BASE);const response=await fetch(`${BASE}/api/artifacts`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({html:source,visibility:'public'})});if(response.status!==201)throw new Error(`Native publication ${response.status}: ${await response.text()}`);return {...await response.json(),token};}
async function api(seed,suffix='',body,method='POST'){const response=await fetch(`${BASE}/api/artifacts/${seed.id}${suffix}`,{method:body===undefined?'GET':method,headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!response.ok)throw new Error(`Artifact API ${response.status}: ${await response.text()}`);return response.json();}
async function openRail(page){if(await page.getByLabel('Annotation sidebar',{exact:true}).isVisible().catch(()=>false))return;await openArtifactControls(page);await page.getByLabel('Toggle comments',{exact:true}).click();await page.getByLabel('Annotation sidebar',{exact:true}).waitFor();}
async function comment(page,frame,selector,body){await frame.locator(selector).click({clickCount:3});await frame.locator(selector).click({button:'right'});await page.getByLabel('Annotation comment',{exact:true}).waitFor();if(body==='Check the Q3 sheet'){
 const dialog=page.getByRole('dialog',{name:'Annotation composer'}),handle=dialog.getByRole('button',{name:'Move comment box'});
 const before=await dialog.boundingBox(),grip=await handle.boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(240,300,{steps:12});await page.mouse.up();const moved=await dialog.boundingBox();check(Math.abs(moved.x-before.x)>5,'the original composer drags across the native iframe');
 }await page.getByLabel('Annotation comment',{exact:true}).fill(body);await page.getByLabel('Save annotation',{exact:true}).click();await page.getByLabel('Annotation composer',{exact:true}).waitFor({state:'hidden'});}
const AGENT_REPLY = [
  'Fixed in `lib/config.ts` — the cap was **10**:',
  '',
  '```ts',
  'const MAX = 10;',
  '```',
  '',
  '- bumped the cap',
  '- added a test',
].join('\n');

async function markdownLeg(browser, { id, token }) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = documentLocator(page);
  await frame.locator('#cap').waitFor({ timeout: 15000 });

  // The comment itself through the browser door, with the session the page
  // already holds — the selection dance is the leg above's subject, not this
  // one's. `cap` is the paragraph, addressed by its node id.
  const head = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: auth })).json();
  const created = await page.evaluate(async ([docId, version]) => {
    const res = await fetch(`/api/my/artifacts/${docId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor: {kind:'html-node',v:1,revision:String(version),nodeId:'cap',quote:''}, body: 'why is the cap 5?' }),
    });
    return { status: res.status, body: await res.text() };
  }, [id, head.version]);
  check(created.status === 201, `the owner leaves a comment (${created.status} ${created.body.slice(0, 120)})`);

  // Open the rail, and open the thread inside it: the compact surfaces show
  // the plain text on purpose, so only the opened thread renders the tree.
  await openArtifactControls(page);
  await page.locator('[aria-label="Toggle comments"]').click();
  await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
  await dismissControls(page);
  const thread = page.locator('[aria-label="Annotation thread"]').first();
  await thread.waitFor({ timeout: 8000 });
  await page.locator('[aria-label="Open annotation thread"]').first().click();
  check(await page.locator('[aria-label="Reply to annotation"]').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), 'the thread opens ready to reply');
  check(await page.locator('[aria-label="Bold"]').first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false), 'the reply box carries the markdown toolbar');

  // THE AGENT ANSWERS over plain HTTP, with a fenced block in the reply.
  const wire = await (await fetch(`${BASE}/api/artifacts/${id}/annotations?status=all`, { headers: auth })).json();
  const ann = wire.annotations?.[0];
  check(!!ann, 'the comment is on the wire for the agent to answer');
  const replied = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ reply: AGENT_REPLY }),
  });
  check(replied.ok, 'the agent replies with a fenced block over plain HTTP');

  // …and it is READ, in the still-open tab, with no reload.
  const rendered = await until(
    () => thread.evaluate((el) => {
      const pre = el.querySelector('pre');
      return {
        pre: pre?.textContent ?? null,
        items: [...el.querySelectorAll('[data-markdown] li')].map((li) => li.textContent),
        code: [...el.querySelectorAll('code')].map((c) => c.textContent),
        strong: [...el.querySelectorAll('strong')].map((c) => c.textContent),
        fence: el.textContent.includes('```'),
        wider: el.scrollWidth > el.clientWidth + 1,
      };
    }).catch(() => null),
    (state) => typeof state?.pre === 'string',
    15000,
  );
  check(rendered?.pre === 'const MAX = 10;', `the fenced block arrives live as a <pre> (got ${JSON.stringify(rendered?.pre)})`);
  check(rendered?.items?.join('|') === 'bumped the cap|added a test', `the list arrives as <li>s (got ${JSON.stringify(rendered?.items)})`);
  check(rendered?.code?.includes('lib/config.ts'), 'a backticked identifier is a <code>, not a backtick');
  check(rendered?.strong?.includes('10'), 'the emphasis is a <strong>');
  check(rendered?.fence === false, 'the fence markers themselves are gone');
  check(rendered?.wider === false, 'the code block scrolls inside the rail rather than widening it');

  // The wire NEVER carries the rendering — the body is the text as written.
  const after = await (await fetch(`${BASE}/api/artifacts/${id}/annotations?status=all`, { headers: auth })).json();
  check(after.annotations?.[0]?.thread?.[1]?.body === AGENT_REPLY, 'the stored body is still the exact markdown text the agent sent');
  await ctx.close();
}


const LONG_AGENT_REPLY = Array.from({ length: 60 }, (_, i) => `line ${i + 1} of the agent's answer`).join('\n');
const HUMAN_LAST_WORD = 'ship it — thanks';

async function foldLeg(browser, { id, token }) {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // A PHONE: the rail is a half-height bottom sheet there, which is where a
  // long comment costs the most.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await becomeOwner(page, BASE, token);
  await page.goto(`${BASE}/a/${id}`, { waitUntil: 'load' });
  const frame = documentLocator(page);
  await frame.locator('#cap').waitFor({ timeout: 15000 });

  const head = await (await fetch(`${BASE}/api/artifacts/${id}`, { headers: auth })).json();
  const created = await page.evaluate(async ([docId, version]) => {
    const res = await fetch(`/api/my/artifacts/${docId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor: {kind:'html-node',v:1,revision:String(version),nodeId:'cap',quote:''}, body: 'why is the cap 5?' }),
    });
    return { status: res.status, body: await res.text() };
  }, [id, head.version]);
  check(created.status === 201, `the owner leaves a comment (${created.status} ${created.body.slice(0, 120)})`);

  const wire = await (await fetch(`${BASE}/api/artifacts/${id}/annotations?status=all`, { headers: auth })).json();
  const ann = wire.annotations?.[0];
  // The screenshot case: the agent answers at length, the human answers shortly.
  const replied = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ reply: LONG_AGENT_REPLY }),
  });
  check(replied.ok, 'the agent answers with sixty lines over plain HTTP');
  const lastWord = await page.evaluate(async ([docId, annId, body]) => {
    const res = await fetch(`/api/my/artifacts/${docId}/annotations/${annId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reply: body }),
    });
    return res.status;
  }, [id, ann.id, HUMAN_LAST_WORD]);
  check(lastWord === 200, `the human answers shortly underneath (${lastWord})`);

  await openArtifactControls(page);
  await page.locator('[aria-label="Toggle comments"]').click();
  // No Escape here, unlike the desktop legs: on a phone the rail IS a sheet,
  // and Escape is how a sheet closes.
  await page.locator('[aria-label="Annotation sidebar"]').waitFor({ timeout: 8000 });
  await page.locator('[aria-label="Open annotation thread"]').first().click({ timeout: 15000 });
  await page.locator('[aria-label="Reply to annotation"]').first().waitFor({ timeout: 8000 });

  const read = () => page.locator('[aria-label="Annotation sidebar"]').evaluate((sheet, reply) => {
    const tree = sheet.getRootNode();
    const thread = tree.querySelector('[aria-label="Annotation thread"]');
    if (!sheet || !thread) return null;
    const node = [...thread.querySelectorAll('p, li, div')]
      .reverse()
      .find((el) => el.textContent?.trim() === reply);
    // The page's own action bar FLOATS OVER the bottom of the sheet on a
    // phone, so the sheet's rect is not what a reader can see. Measure against
    // what is left of it.
    const bar = tree.querySelector('[aria-label="Page actions"][data-scroll-hidden="false"]');
    const barTop = bar?.getBoundingClientRect().top ?? Infinity;
    const sheetBox = sheet.getBoundingClientRect();
    const replyBox = node?.getBoundingClientRect() ?? null;
    // The agent's answer is the second message; its TOP is what says whether
    // the conversation still reads as one.
    const answer = thread.querySelectorAll('li')[1]?.getBoundingClientRect() ?? null;
    return {
      clamped: !!thread.querySelector('[data-folded-body="clamped"]'),
      control: thread.querySelector('[aria-label="Show whole comment"]')?.textContent ?? null,
      hasLastLine: thread.textContent.includes("line 60 of the agent's answer"),
      barMeasured: Number.isFinite(barTop),
      sheet: { top: sheetBox.top, bottom: Math.min(sheetBox.bottom, barTop) },
      reply: replyBox && { top: replyBox.top, bottom: replyBox.bottom },
      answerTop: answer?.top ?? null,
    };
  }, HUMAN_LAST_WORD);

  /*
   * WAIT FOR THE GEOMETRY TO STOP MOVING, NOT MERELY FOR THE FOLD TO EXIST.
   *
   * Opening a thread scrolls it into view, and the fold can be in the DOM
   * before that scroll has settled — so `clamped === true` is a signal about
   * the CONTENT and says nothing about where the content currently is. Reading
   * on that signal alone measures a sheet mid-scroll.
   *
   * Measured, and this is the whole reason the assertions below are worth
   * anything: over 33 local runs the thread read 88px low twice, always the
   * same 88 (thread top 471 rather than 383, the reply at 843 rather than 755,
   * every element inside it identical in size). The same page read again 800ms
   * later was at the settled position every time. In CI it cost two red merge
   * gates and three re-runs, and it read as a product bug — a phone reader
   * unable to see the human's reply — which it is not.
   *
   * So the wait is for the ANSWER'S TOP to repeat: a scroll that has finished
   * reports the same offset twice, a scroll in flight does not. Polling for
   * stability rather than sleeping a fixed time keeps the settled case fast.
   */
  const readSettled = async () => {
    let previous = null;
    for (let i = 0; i < 60; i++) {
      const s = await read();
      if (s?.clamped === true && s.answerTop !== null && s.answerTop === previous) return s;
      previous = s?.answerTop ?? null;
      await page.waitForTimeout(50);
    }
    return read();
  };
  const folded = await readSettled();
  check(folded?.clamped === true, 'the sixty-line agent answer arrives folded');
  // The page's floating action bar is gone (the chrome lives in the document
  // now), so the sheet's own rect IS the visible area: nothing covers it.
  check(/^show more \(\d+ lines\)$/.test(folded?.control ?? ''), `the fold offers to open itself (${JSON.stringify(folded?.control)})`);
  check(folded?.hasLastLine === true, 'clamped, not truncated: the whole answer is still in the document');
  check(!!folded?.reply
    && folded.reply.top >= folded.sheet.top - 1
    && folded.reply.bottom <= folded.sheet.bottom + 1,
  `the human's own reply is visible without scrolling the sheet (reply ${JSON.stringify(folded?.reply)} in sheet ${JSON.stringify(folded?.sheet)})`);
  check(typeof folded?.answerTop === 'number' && folded.answerTop >= folded.sheet.top - 1,
    `the agent's answer BEGINS on screen too — the fold is what fits both (answer top ${folded?.answerTop}, sheet top ${folded?.sheet.top})`);

  await page.locator('[aria-label="Show whole comment"]').first().click();
  const opened = await until(read, (s) => s?.clamped === false, 5000);
  check(opened?.clamped === false, 'tapping "show whole comment" expands it');
  check(await page.locator('[aria-label="Show less of comment"]').first().isVisible(), 'and offers to fold it back');
  // THE A/B, so nothing above can pass vacuously: opened, the same sixty lines
  // push the human's reply straight off the sheet. That is what the fold buys,
  // measured on the same thread a moment apart.
  check(!!opened?.reply && opened.reply.top > opened.sheet.bottom,
    `unfolded, the sixty lines push the human's reply off the sheet (reply ${JSON.stringify(opened?.reply)} vs sheet ${JSON.stringify(opened?.sheet)})`);
  await page.locator('[aria-label="Show less of comment"]').first().click();
  const refolded = await until(read, (s) => s?.clamped === true, 5000);
  check(!!refolded?.reply && refolded.reply.bottom <= refolded.sheet.bottom + 1, 'folding it back brings the reply home');

  // ── a resolved card reads as resolved ──────────────────────────────────
  const resolvedRes = await fetch(`${BASE}/api/artifacts/${id}/annotations/${ann.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ resolve: true }),
  });
  check(resolvedRes.ok, 'the agent resolves the thread over plain HTTP');
  const muted = await until(
    () => page.locator('[aria-label="Resolved annotation thread"]').first().evaluate(card => {
      const open = card.getRootNode().querySelector('[aria-label="Annotation thread"]');
      return card
        ? { opacity: Number(getComputedStyle(card).opacity), open: open ? Number(getComputedStyle(open).opacity) : null }
        : null;
    }),
    (state) => typeof state?.opacity === 'number',
    12000,
  );
  check(!!muted && muted.opacity > 0.4 && muted.opacity < 0.8,
    `the resolved card is muted rather than identical to an open one (opacity ${muted?.opacity})`);
  check(muted?.open === null || muted.open === 1, `an open card beside it stays at full opacity (${muted?.open})`);
  check(await page.locator('[aria-label="Hide resolved conversation"]').first().isVisible(),
    'muted is not disabled: the resolved conversation remains open and dismissible');
  await ctx.close();
}


async function ownerLeg(browser,seed){
 const ctx=await browser.newContext({viewport:{width:1280,height:900}}),page=await ctx.newPage();
 try{
  await becomeOwner(page,BASE,seed.token);await page.goto(`${BASE}/a/${seed.id}`);
  const frame=documentLocator(page);await frame.locator('#figure').waitFor();
  const before=await api(seed);
  await comment(page,frame,'#figure','Check the Q3 sheet');
  const saved=await until(()=>api(seed,'/annotations?status=all'),w=>w.annotations?.length===1);
  const ann=saved.annotations[0];
  check(ann.anchor?.kind==='html-node'&&ann.anchor.nodeId==='figure'&&ann.quote.includes('Revenue'),'native right-click preserves selected words and explicit HTML identity');
  check(!(ann.anchor?.path),'HTML comments never persist compiler coordinates');
  const after=await api(seed);check(before.version===after.version&&before.edit_id===after.edit_id,'commenting changes relations without publishing a page version');
  const overlay=frame.locator('[data-af="annotation-overlay"] > div');
  await expect(overlay).not.toHaveCount(0);check(true,'saved native text receives an inert highlight overlay');
  const marker=page.locator('[aria-label^="Open annotation conversation by"]');await marker.first().waitFor();
  await marker.first().hover();await expect(page.getByLabel('Open annotation comments')).toContainText('Q3 sheet');check(true,'ambient marker reveals the conversation without opening the sidebar');
  const card=page.locator('[data-annotation-id]').first();await card.getByRole('button',{name:'Reply',exact:true}).click();
  const reply=page.getByRole('textbox',{name:'Reply to annotation',exact:true});await reply.fill('Answer from the hover card');await page.mouse.move(5,5);check(await reply.isVisible(),'a hover reply draft stays open when the pointer leaves');
  await page.getByRole('button',{name:'Send reply',exact:true}).click();await until(()=>api(seed,'/annotations'),wire=>wire.annotations[0].thread.some(row=>row.body==='Answer from the hover card'));check(true,'the original hover reply composer saves on the native thread');await page.mouse.move(5,5);
  await openRail(page);await expect(page.getByLabel('Annotation sidebar',{exact:true})).toContainText('Q3 sheet');
  check(await page.evaluate(()=>location.hash)==='','opening comments enters no editing mode');
  await openArtifactControls(page);check(await page.getByLabel('Edit artifact',{exact:true}).count()===0,'native reader never offers the retired source editor');await dismissControls(page);
  await api(seed,`/annotations/${ann.id}`,{reply:'Recomputed: 34%.',resolve:true});
  await expect(page.getByLabel('Resolved annotation thread')).toContainText('Recomputed');check(true,'agent reply and resolve arrive in the still-open browser over the retained channel');
  await expect(overlay).toHaveCount(0);check(true,'resolving clears the native highlight without removing history');
  await page.getByLabel('Close comments',{exact:true}).click();
  await marker.first().hover();await marker.first().click();await page.getByLabel('Hide resolved conversation').waitFor();
  check(true,'the final resolved conversation remains accessible from its marker');
  // Named people remain in the original composer; this exercises real mention lookup, not text containing @.
  await page.getByLabel('Hide resolved conversation').click();
  await frame.locator('#figure').click({button:'right'});const field=page.getByLabel('Annotation comment',{exact:true});await field.waitFor();
  await field.fill('@');await page.getByLabel('Mention people',{exact:true}).waitFor();
  check(await page.getByRole('listbox',{name:'People'}).isVisible(),'comment composition offers the retained person-mention picker');
  await page.keyboard.press('Escape');await field.fill('A second comment');await page.getByLabel('Save annotation',{exact:true}).click();
  await page.reload();await frame.locator('#figure').waitFor();
  await expect(page.locator('header[aria-label="Page bar"] [aria-label="Comment"]')).toContainText('1');check(true,'open count and persisted threads reconnect on reload');
  const reader=await browser.newContext(),guest=await reader.newPage();try{await guest.goto(`${BASE}/a/${seed.id}`);await documentLocator(guest).locator('#figure').waitFor();check(await guest.locator('[aria-label^="Open annotation conversation by"]').count()===0,'logged-out readers receive no private discussion markers');}finally{await reader.close();}
 }finally{await ctx.close();}
}
const DYNAMIC=html(`<h1>Data-derived identities</h1><div><button id="reverse">Reverse</button><button id="remove">Remove</button><button id="restore">Restore</button></div><ul id="tasks" data-af-id="tasks"></ul><aside data-af-id="other"><p id="elsewhere">First task</p></aside><script>
document.querySelector('#elsewhere').dataset.afId='task:123';let rows=[{id:'123',label:'First task'},{id:'456',label:'Second task'}];const render=()=>document.querySelector('#tasks').replaceChildren(...rows.map(row=>{const li=document.createElement('li');li.dataset.afId='task:'+row.id;li.textContent=row.label;return li}));render();document.querySelector('#reverse').onclick=()=>{rows.reverse();render()};document.querySelector('#remove').onclick=()=>{rows=rows.filter(row=>row.id!=='123');render()};document.querySelector('#restore').onclick=()=>{rows.push({id:'123',label:'First task'});render()};</script>`);
async function dynamicLeg(browser,seed){
 const ctx=await browser.newContext(),page=await ctx.newPage();try{
  await becomeOwner(page,BASE,seed.token);await page.goto(`${BASE}/a/${seed.id}`);const frame=documentLocator(page);await frame.locator('[data-af-id="task:123"]').waitFor();
  await comment(page,frame,'[data-af-id="task:123"]','Follow this task');
  const wire=await until(()=>api(seed,'/annotations'),w=>w.annotations?.length===1);check(wire.annotations[0].anchor.nodeId==='task:123'&&wire.annotations[0].anchor.ancestorId==='tasks','native dynamic ID is persisted inside its saved ancestor scope');
  const painted=()=>frame.locator('[data-af="annotation-overlay"] > div');await expect(painted()).not.toHaveCount(0);
  await frame.locator('#reverse').click();await expect(frame.locator('#tasks li').first()).toHaveText('Second task');await expect(painted()).not.toHaveCount(0);check(true,'dynamic item comment survives reorder');
  await frame.locator('#remove').click();await expect(frame.locator('[data-af-id="task:123"]')).toHaveCount(0);await expect(painted()).toHaveCount(0);check(true,'removed dynamic item loses its highlight instead of retargeting');
  await frame.locator('#restore').click();await expect(painted()).not.toHaveCount(0);check(true,'restoring the same data identity restores its highlight');
  await page.reload();await frame.locator('[data-af-id="task:123"]').waitFor();await expect(painted()).not.toHaveCount(0);check(true,'dynamic comment reconnects after a fresh runtime launch');
 }finally{await ctx.close();}
}
async function liveQuoteLeg(browser,seed){
 const ctx=await browser.newContext(),page=await ctx.newPage();try{
  await becomeOwner(page,BASE,seed.token);await page.goto(`${BASE}/a/${seed.id}`);const frame=documentLocator(page);await frame.locator('#figure').waitFor();
  await comment(page,frame,'#figure','Keep the originally selected words');const original=(await api(seed,'/annotations')).annotations[0];
  await api(seed,'',{html:DOC.replace('Revenue grew 40% in Q3.','Revenue grew 34% in Q3.')},'PUT');
  await expect(frame.locator('#figure')).toHaveText('Revenue grew 34% in Q3.');check(true,'whole-source publication reaches the open native reader without refresh');
  const updated=await api(seed,'/annotations');check(updated.annotations[0].anchor.nodeId==='figure'&&!updated.annotations[0].orphaned&&updated.annotations[0].quote===original.quote&&!updated.annotations[0].quote_found,'rewriting source keeps stable identity and the original quote, reporting missing words honestly');
  await comment(page,frame,'#figure','Comment after a live publication');
  const after=await until(()=>api(seed,'/annotations'),wire=>wire.annotations?.length===2);check(after.annotations.some(row=>row.anchor.revision==='2'),'right-click selection uses the freshly served native revision');
 }finally{await ctx.close();}
}

async function selectionLeg(browser,seed){
 const ctx=await browser.newContext({viewport:{width:1280,height:900}}),page=await ctx.newPage();try{
  await page.addInitScript(()=>{if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'setCaptureHandleConfig',{value:undefined});});
  await becomeOwner(page,BASE,seed.token);await page.goto(`${BASE}/a/${seed.id}`);const frame=documentLocator(page);await frame.locator('#figure').waitFor();
  await openRail(page);const tool=page.getByRole('button',{name:'Select',exact:true});await expect(tool).toHaveAttribute('aria-pressed','true');
  await frame.locator('#figure').click();await page.getByLabel('Annotation comment',{exact:true}).waitFor();
  check(true,'original sidebar Select opens a native node composer');
  await page.getByLabel('Annotation comment',{exact:true}).fill('Picked block');await page.getByLabel('Save annotation',{exact:true}).click();
  await expect(tool).toHaveAttribute('aria-pressed','true');check(true,'saving restores Select for the next comment');await page.keyboard.press('Escape');await expect(tool).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Screenshot',exact:true}).click();await page.getByRole('status',{name:'Screenshot tool active'}).waitFor();
  const rect=await frame.locator('#figure').boundingBox();await page.mouse.move(rect.x+4,rect.y+4);await page.mouse.down();await page.mouse.move(rect.x+Math.min(100,rect.width/2),rect.y+Math.min(20,rect.height-2),{steps:12});await page.mouse.up();
  await page.getByLabel('Annotation comment',{exact:true}).waitFor();const fallback=page.getByRole('button',{name:'Continue without screenshot',exact:true});if(await fallback.isVisible())await fallback.click();
  await page.getByLabel('Annotation comment',{exact:true}).fill('Selected area');await page.getByLabel('Save annotation',{exact:true}).click();
  const wire=await until(()=>api(seed,'/annotations'),w=>w.annotations?.length===2);const area=wire.annotations.find(row=>row.range?.kind==='area');
  check(area?.anchor?.kind==='html-node'&&area.range.box.w>0&&area.range.box.x+area.range.box.w<=1,'drawn area persists fractional geometry beside explicit HTML identity');
  const cancel=page.getByRole('button',{name:'Cancel picking',exact:true});if(await cancel.isVisible())await cancel.click();
  await frame.locator('#figure').click({button:'right'});const field=page.getByLabel('Annotation comment',{exact:true});await field.waitFor();
  const png=(await sharp({create:{width:80,height:40,channels:3,background:{r:20,g:100,b:200}}}).png().toBuffer()).toString('base64');
  await field.evaluate((element,png)=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],'evidence.png',{type:'image/png'}));element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true,composed:true}));},png);
  await page.getByLabel('Screenshot editor',{exact:true}).waitFor();await field.fill('Pasted evidence');await page.getByLabel('Save annotation',{exact:true}).click();
  const withImage=await until(()=>api(seed,'/annotations'),w=>w.annotations?.some(row=>row.image));check(withImage.annotations.some(row=>row.image),'pasted image uploads through the retained comment attachment path');
  await page.reload();await frame.locator('#figure').waitFor();await openRail(page);await expect(page.getByLabel('Annotation sidebar',{exact:true}).locator('img')).not.toHaveCount(0);check(true,'comment images reconnect after reload');
 }finally{await ctx.close();}
}

async function run(){const browser=await launchChromium();try{
 const fixtures=await Promise.all([publish(DOC),publish(CAP_DOC),publish(CAP_DOC),publish(DYNAMIC),publish(DOC),publish(DOC)]);
 const runLeg=async(leg,fixture)=>{try{await leg(browser,fixture);}catch(error){check(false,`${leg.name}: ${error.stack??error}`);}};
 await Promise.all([[ownerLeg,fixtures[0]],[markdownLeg,fixtures[1]],[dynamicLeg,fixtures[3]],[selectionLeg,fixtures[4]],[liveQuoteLeg,fixtures[5]]].map(([leg,fixture])=>runLeg(leg,fixture)));
 await runLeg(foldLeg,fixtures[2]);
}finally{await browser.close();}}
run().then(()=>check.done()).catch(error=>{console.error(error);process.exit(1)});
