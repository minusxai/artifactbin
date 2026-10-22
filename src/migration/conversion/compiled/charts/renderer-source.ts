import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CompiledChartPlan } from "./contracts.ts";
/** Dev-only bundler inputs. All dependencies are read from the archived, installed compiler. */
export async function chartRendererSources(
  archivedRoot: string,
  plans: readonly CompiledChartPlan[],
) {
  const root = path.resolve(archivedRoot, "node_modules");
  for (const [name, version] of [
    ["vega", "6.3.1"],
    ["vega-lite", "6.4.3"],
    ["vega-view", "6.1.2"],
    ["vega-encode", "5.2.2"],
    ["vega-transforms", "5.2.2"],
    ["vega-view-transforms", "5.2.2"],
    ["vega-functions", "6.1.3"],
    ["vega-expression", "6.2.2"],
    ["vega-dataflow", "6.1.3"],
    ["vega-geo", "5.1.3"],
    ["vega-force", "5.1.3"],
    ["vega-hierarchy", "5.1.3"],
    ["vega-label", "2.1.3"],
    ["vega-regression", "2.1.3"],
    ["vega-voronoi", "5.1.3"],
    ["vega-wordcloud", "5.1.3"],
    ["vega-runtime", "7.1.3"],
    ["vega-interpreter", "2.3.1"],
  ]) {
    const pkg = JSON.parse(
      await readFile(path.join(root, name!, "package.json"), "utf8"),
    );
    if (pkg.version !== version)
      throw Error("Unexpected archived chart dependency version");
  }
  const runtimePath = fileURLToPath(new URL("./runtime.ts", import.meta.url));
  const entry = `import {View} from 'vega-view';
import {transforms} from 'vega-dataflow';
import * as tx from 'vega-transforms';
import * as vtx from 'vega-view-transforms';
import * as encode from 'vega-encode';
import * as geo from 'vega-geo';
import * as force from 'vega-force';
import * as hierarchy from 'vega-hierarchy';
import * as label from 'vega-label';
import * as regression from 'vega-regression';
import * as voronoi from 'vega-voronoi';
import * as wordcloud from 'vega-wordcloud';
import {expressionInterpreter} from 'vega-interpreter';
import {createCompiledCharts} from ${JSON.stringify(runtimePath)};
Object.assign(transforms,tx,vtx,encode,geo,force,hierarchy,label,regression,voronoi,wordcloud);
export const charts=createCompiledCharts(${JSON.stringify(plans)},{
create:(runtime,element)=>new View(runtime,{expr:expressionInterpreter,renderer:'svg',container:element,hover:true,loader:{load:()=>Promise.reject(Error('Chart resource unavailable')),sanitize:()=>Promise.reject(Error('Chart navigation unavailable'))}}),
observe:(element,resize)=>{const observer=new ResizeObserver(resize);observer.observe(element);return ()=>observer.disconnect();}
});`;
  return {
    entry,
    plugin: {
      name: "offline-chart-renderer",
      setup(b: any) {
        // The kit imports pure drawing helpers from chart.ts; its unused lazy
        // loader must still resolve before tree-shaking. Route that one trusted
        // controller edge to the explicit offline module, never the old compiler.
        b.onResolve({ filter: /^\.\/chart-controller$/ }, (args: any) => {
          if (
            path.resolve(args.importer) !==
            path.resolve(archivedRoot, "services/app/lib/islands/chart.ts")
          )
            throw Error("Unexpected archived chart controller import");
          return {
            path: "kit-chart-controller",
            namespace: "offline-chart-kit",
          };
        });
        b.onLoad({ filter: /.*/, namespace: "offline-chart-kit" }, () => ({
          contents:
            "import {charts} from 'migration-charts';export const mountChart=charts.mountChart;",
          loader: "js",
        }));
        b.onResolve({ filter: /^vega(?:-[a-z-]+)?$/ }, (args: any) => {
          if (args.path === "vega-loader")
            return { path: "chart-no-loader", namespace: "offline-chart" };
          if (["vega", "vega-parser", "vega-lite"].includes(args.path))
            throw Error("Chart compiler cannot enter browser bundle");
          if (
            [
              "vega-runtime",
              "vega-functions",
              "vega-expression",
              "vega-interpreter",
            ].includes(args.path)
          )
            return { path: path.join(root, args.path, "index.js") };
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: "offline-chart" }, () => ({
          contents:
            "const refuse=()=>{throw Error('Chart resource unavailable')};export const loader=()=>({load:refuse,sanitize:refuse});export const read=refuse;export const responseType=refuse;",
          loader: "js",
        }));
        b.onLoad(
          {
            filter:
              /[/\\]vega-(?:expression|functions)[/\\]src[/\\]parser\.js$/,
          },
          () => ({
            contents:
              "export default ()=>{throw Error('Chart expressions must be compiled offline')};",
            loader: "js",
          }),
        );
        b.onLoad(
          { filter: /[/\\]vega-expression[/\\]src[/\\]codegen\.js$/ },
          () => ({
            contents: "export default ()=>({functions:{}});",
            loader: "js",
          }),
        );
        b.onLoad(
          { filter: /[/\\]vega-runtime[/\\]src[/\\]expression\.js$/ },
          () => ({
            contents:
              "const refuse=()=>{throw Error('Compiled charts require the expression interpreter')};export default {operator:refuse,parameter:refuse,event:refuse,handler:refuse,encode:refuse,codegen:{get:refuse,comparator:refuse}};",
            loader: "js",
          }),
        );
      },
    },
  };
}
