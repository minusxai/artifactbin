import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {datavizExamples,nativeDatavizFixture,mountNativeDataviz} from '../fixtures/native-dataviz.mjs';
it('uses both shipped reference grammars and separate exact registered ESM imports',async()=>{
 const reference=await readFile(new URL('../../services/app/skills/artifactbin/references/dataviz.md',import.meta.url),'utf8');
 const examples=datavizExamples(reference),source=nativeDatavizFixture(examples);
 expect(examples.lite.mark).toBe('bar');expect(examples.vega.data[0].name).toBe('rows');
 expect(source).toContain('/libraries/vega-6.3.1/index.js');expect(source).toContain('/libraries/vega-lite-6.4.3/index.js');
 expect(source).toContain('expressionInterpreter');expect(source).toContain('Content-Security-Policy');expect(source).not.toContain("'unsafe-eval'");expect(source).toContain('Completed tasks by category');
 expect(()=>datavizExamples('```json\n{}\n```')).toThrow('two');
});
it('retains one actual view per chart, refreshes theme/size, updates native data, and disconnects on disposal',async()=>{
 const dom=new JSDOM('<html><body><div id="lite-chart"></div><div id="vega-chart"></div><table><tbody id="native-rows"></tbody></table></body></html>');
 const document=dom.window.document;let width=500,color='#57606a',theme='light',disconnected=0;const views=[],observers=[];
 const ports={document,measure:()=>width,theme:()=>({key:theme,label:color,grid:'#d0d7de'}),observeResize:(_node,callback)=>{observers.push(callback);return()=>disconnected++;},observeTheme:callback=>{observers.push(callback);return()=>disconnected++;},vega:{expressionInterpreter:{},parse:(spec,config,options)=>({spec,config,options}),View:class{constructor(parsed,options){this.parsed=parsed;this.options=options;this.rows=[];views.push(this);}width(value){this.size=value;return this;}resize(){return this;}async runAsync(){this.runs=(this.runs||0)+1;return this;}data(_name,rows){if(rows){this.rows=rows;return this;}return this.rows;}finalize(){this.closed=true;}}},compile:spec=>({spec})};
 const controller=await mountNativeDataviz({lite:{data:{values:[]}},vega:{data:[]}},ports);
 expect(views).toHaveLength(2);expect(views.every(view=>view.parsed.options.ast&&view.options.expr===ports.vega.expressionInterpreter)).toBe(true);
 width=240;await controller.refresh();expect(views).toHaveLength(2);expect(views.every(view=>view.size===240)).toBe(true);
 theme='dark';color='#c9d1d9';await controller.refresh();expect(views).toHaveLength(4);expect(views.slice(0,2).every(view=>view.closed)).toBe(true);
 await controller.updateNativeRows([{category:'Updated',count:7}]);expect(views.at(-1).rows).toEqual([{category:'Updated',count:7}]);
 controller.dispose();expect(disconnected).toBe(2);expect(views.every(view=>view.closed)).toBe(true);
 const runs=views.reduce((sum,view)=>sum+view.runs,0);await Promise.all(observers.map(callback=>callback()));await controller.refresh();expect(views.reduce((sum,view)=>sum+view.runs,0)).toBe(runs);
 await expect(controller.updateNativeRows([{category:'Late',count:8}])).rejects.toThrow('disposed');dom.window.close();
});
