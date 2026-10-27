import {describe,expect,it} from 'vitest';
import {autofixHtml,formatAutofixReport,scriptFingerprint} from '../index';
const findProblems=(html:string,options?:Parameters<typeof autofixHtml>[1])=>autofixHtml(html,options).problems;
import {canonicalizeHtmlPage} from '../../html-page';

const page=(head:string,body='<h1>Hi</h1>')=>`<!doctype html>\n<html>\n<head>\n${head}\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
const OK='<meta charset="utf-8">\n<meta name="viewport" content="width=device-width">\n<script src="/af/v1/core.js"></script>';
const rules=(html:string)=>autofixHtml(html).fixes.map(fix=>fix.rule);

describe('autofix rules',()=>{
 it('names invalid install metadata that publish would silently ignore',()=>{
  const bad=findProblems(page(OK+'\n<meta name="artifactbin:pwa-theme-color" content="green">\n<meta name="artifactbin:pwa-icon" content="logo.png">\n<meta name="artifactbin:pwa-nmae" content="x">'));
  expect(bad.map(problem=>problem.rule)).toEqual(['pwa-metadata','pwa-metadata','pwa-metadata']);
  expect(bad[0]!.message).toContain('six-digit hex');expect(bad[2]!.message).toContain('unknown setting');
  expect(findProblems(page(OK+'\n<meta name="artifactbin:pwa-enabled" content="true">\n<meta name="artifactbin:pwa-theme-color" content="#234b35">'))).toEqual([]);
 });
 it('leaves a correct page byte-identical and reports clean',()=>{
  const html=page(OK),result=autofixHtml(html,{exists:()=>true});
  expect(result.html).toBe(html);expect(result.changed).toBe(false);
  expect(formatAutofixReport(result)).toMatch(/^autofix: clean/);
 });
 it('repairs a hand-written core script exactly as the server would',()=>{
  for(const core of ['<script defer src="/af/v1/core.js"></script>','<script type="module" src="/af/v1/core.js"></script>','<script async data-af="core" src="/af/v1/core.js"></script>']){
   const result=autofixHtml(page('<meta charset="utf-8"><meta name="viewport" content="x">',`<h1>Hi</h1>${core}<script src="/af/v1/core.js"></script>`));
   expect(result.fixes.map(fix=>fix.rule)).toEqual(['core-script']);
   expect(result.html.match(/af\/v1\/core\.js/g)).toHaveLength(1);
   // The server's own canonical pass finds nothing left to move.
   expect(canonicalizeHtmlPage(result.html).html.replace(/ data-af-id="[^"]+"/g,'')).toBe(result.html);
  }
 });
 it('adds a missing core as routine, not as an author fix',()=>{
  const result=autofixHtml(page('<meta charset="utf-8"><meta name="viewport" content="x">'));
  expect(result.fixes).toEqual([]);expect(result.routine).toEqual(['added core script']);expect(result.html).toContain('<script src="/af/v1/core.js"></script>');
 });
 it('adds missing charset and viewport metadata first in head',()=>{
  const result=autofixHtml(page('<script src="/af/v1/core.js"></script>'));
  expect(result.fixes.map(fix=>fix.rule)).toEqual(['charset','viewport']);
  expect(result.html.indexOf('<meta charset="utf-8">')).toBeLessThan(result.html.indexOf('name="viewport"'));
  expect(result.html.indexOf('name="viewport"')).toBeLessThan(result.html.indexOf('core.js'));
  expect(result.fixes[0]!.after[0]!.line).toBeGreaterThan(0);
  expect(rules(page('<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="viewport" content="x"><script src="/af/v1/core.js"></script>'))).toEqual([]);
 });
 it('refuses inline script syntax errors at the HTML line, for classic, module and JSON blocks',()=>{
  const html=page(OK,'<h1>Hi</h1>\n<script>\nconst ok = 1;\nconst x = ;\n</script>\n<script type="module">import {a} from "./a.js"; await a;</script>\n<script type="application/json" data-af="state">{bad}</script>');
  const problems=findProblems(html).filter(problem=>problem.rule==='script-syntax');
  expect(problems).toHaveLength(2);
  expect(problems[0]!.line).toBe(html.split('\n').findIndex(line=>line.includes('const x = ;'))+1);
  expect(problems[1]!.message).toContain('JSON');
  expect(autofixHtml(html).html).toBe(html);
 });
 it('refuses duplicate data-af-id and duplicate id, but not ids inside templates',()=>{
  const problems=findProblems(page(OK,'<p id="a" data-af-id="n1">1</p><p id="a" data-af-id="n1">2</p><template><i id="t"></i><i id="t"></i></template>'));
  expect(problems.map(problem=>problem.rule).sort()).toEqual(['duplicate-data-af-id','duplicate-id']);
 });
 it('refuses missing relative local assets only, with file lines',()=>{
  const html=page(OK+'\n<link rel="stylesheet" href="./style.css">\n<link rel="af-dataset" href="ref:ABCDEF" data-af-name="d">','<img src="img/a.png"><img src="https://x.test/a.png"><img src="ref:ABCDEF"><script type="module">import "./lib.js";</script>');
  const seen:string[]=[];
  const problems=findProblems(html,{exists:path=>{seen.push(path);return path==='style.css';}});
  expect(seen.sort()).toEqual(['img/a.png','lib.js','style.css']);
  expect(problems.map(problem=>[problem.rule,problem.message.split(': ')[1]])).toEqual([['missing-asset','img/a.png'],['missing-asset','./lib.js']]);
 });
 it('keeps D2 off, and moves design selection into head metadata only when enabled',()=>{
  const html=page(OK).replace('<html>','<html data-af-dark="false" data-af-design-system="riso">');
  expect(autofixHtml(html).html).toBe(html);
  const on=autofixHtml(html,{rules:{designSystemMeta:true}});
  expect(on.fixes.map(fix=>fix.rule)).toEqual(['design-system-meta']);
  expect(on.html).toContain('<html>');expect(on.html).toContain('<meta name="artifactbin:design-system" content="riso">');
 });
 it('is deterministic and idempotent',()=>{
  const html=page('<title>t</title>','<p>x</p><script defer src="/af/v1/core.js"></script>');
  const once=autofixHtml(html).html;
  expect(autofixHtml(html).html).toBe(once);
  expect(autofixHtml(once).html).toBe(once);
 });
 it('caps the report, says where fixes landed, and always starts with autofix:',()=>{
  const body=Array.from({length:12},(_,i)=>`<p id="d">${i}</p>`).join('');
  const report=formatAutofixReport(autofixHtml(page('',body)),{file:'index.html',landed:'also written to index.html',routine:['added 3 data-af-id'],limit:4});
  expect(report.startsWith('autofix: ')).toBe(true);expect(report).toContain('also written to index.html');
  expect(report).toMatch(/… and \d+ more/);expect(report).toContain('added 3 data-af-id');expect(report).toMatch(/index\.html:\d+:\d+/);
 });
});

describe('script fingerprint',()=>{
 const base=page(OK+'\n<style>h1{color:red}</style>\n<link rel="stylesheet" href="/a/X/assets?dependency=s&amp;revision=1">','<h1 data-af-id="h">Hi</h1>\n<script type="module" data-af-id="m">import {x} from "/a/X/assets?dependency=d&revision=1";x();</script>');
 const fp=scriptFingerprint(base);
 it('ignores text, markup, CSS, stylesheet links and script identities',()=>{
  for(const edit of [base.replace('>Hi<','>Hello<'),base.replace('color:red','color:blue'),base.replace('revision=1">','revision=2">'),base.replace('<h1 data-af-id="h">Hi</h1>','<h2>New</h2>'),base.replace('data-af-id="m"','data-af-id="other"')])
   expect(scriptFingerprint(edit)).toBe(fp);
 });
 it('changes when any script code, attribute or imported revision changes',()=>{
  for(const edit of [base.replace('x();','x(1);'),base.replace('type="module"','type="module" async'),base.replace('dependency=d&revision=1','dependency=d&revision=2'),base.replace('</body>','<script>1</script></body>')])
   expect(scriptFingerprint(edit)).not.toBe(fp);
 });
 it('folds in local script content revisions when given',()=>{
  const local=page(OK,'<script src="./app.js"></script>');
  expect(scriptFingerprint(local,()=>'a')).not.toBe(scriptFingerprint(local,()=>'b'));
  expect(scriptFingerprint(local,()=>'a')).toBe(scriptFingerprint(local,()=>'a'));
 });
});

describe('ID carry-forward (D11)',()=>{
 const v1=canonicalizeHtmlPage(page('<title>Plan</title>',`<header><h1>Quarterly plan</h1><p class="lede">Three bets for the next quarter.</p></header>
<section><h2>Bets</h2><ul><li>Ship the importer to every workspace</li><li>Halve the time to first chart</li><li>Launch shared dashboards</li></ul></section>
<section><h2>Risks</h2><p>Hiring may slip by a month.</p><img src="chart.png" alt="Trend"></section>`));
 const idOf=(html:string,text:string)=>new RegExp(`data-af-id="([^"]+)"[^>]*>${text}`).exec(html)?.[1];
 it('keeps IDs of unchanged and lightly reworded elements when the whole file is regenerated without IDs; new elements get new IDs',()=>{
  const regenerated=page('<title>Plan</title>',`<header><h1>Quarterly plan</h1><p class="lede">Three bets for next quarter.</p></header>
<section><h2>Bets</h2><ul><li>Ship the importer to every workspace</li><li>Halve the time to the first chart</li><li>Launch shared dashboards</li><li>Price the team plan</li></ul></section>
<section><h2>Risks</h2><p>Hiring may slip by a month or two.</p><img src="chart.png" alt="Trend"></section>`);
  const v2=canonicalizeHtmlPage(regenerated,{previousHtml:v1.html,ledger:v1.ledger});
  for(const text of ['Quarterly plan','Three bets','Bets<','Ship the importer','Halve the time','Launch shared','Risks<','Hiring may slip'])
   expect(idOf(v2.html,text),text).toBe(idOf(v1.html,text));
  expect(/data-af-id="([^"]+)"[^>]*alt="Trend"|alt="Trend"[^>]*data-af-id="([^"]+)"/.exec(v2.html)?.slice(1).find(Boolean)).toBe(/alt="Trend"[^>]*data-af-id="([^"]+)"/.exec(v1.html)?.[1]);
  const fresh=idOf(v2.html,'Price the team plan');expect(fresh).toBeTruthy();expect(v1.nodeIds).not.toContain(fresh);
  expect(v2.carry).toEqual({carried:v1.nodeIds.length,fresh:1});
  expect(new Set(v2.nodeIds).size).toBe(v2.nodeIds.length);
 });
 it('never reuses an ID still written elsewhere, nor a retired one, and is deterministic',()=>{
  const mixed=page('<title>Plan</title>',`<h1 data-af-id="${idOf(v1.html,'Bets<')}">Quarterly plan</h1><h2>Bets</h2>`);
  const a=canonicalizeHtmlPage(mixed,{previousHtml:v1.html,ledger:v1.ledger}),b=canonicalizeHtmlPage(mixed,{previousHtml:v1.html,ledger:v1.ledger});
  expect(a.html).toBe(b.html);expect(new Set(a.nodeIds).size).toBe(a.nodeIds.length);
  const removed=canonicalizeHtmlPage(v1.html.replace(/<p class="lede"[^>]*>[^<]*<\/p>/,''),{previousHtml:v1.html,ledger:v1.ledger});
  const back=canonicalizeHtmlPage(removed.html.replace(/ data-af-id="[^"]+"/g,'').replace('</header>','<p class="lede">Three bets for the next quarter.</p></header>'),{previousHtml:removed.html,ledger:removed.ledger});
  expect(back.nodeIds).not.toContain(idOf(v1.html,'Three bets'));
 });
});
