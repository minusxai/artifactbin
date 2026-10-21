import { buildSchema, validateSchema } from "graphql";
import { build } from "esbuild";
import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import type {
  Host,
  Principal,
  Invocation,
  Json,
  Limits,
  CapabilityHandler,
} from "./contracts.ts";
const here = dirname(fileURLToPath(import.meta.url));
function json(value: unknown): string {
  const seen = new Set();
  function visit(x: any, depth = 0) {
    if (depth > 64) throw Error("JSON depth");
    if (x === null || typeof x === "string" || typeof x === "boolean") return;
    if (typeof x === "number" && Number.isFinite(x)) return;
    if (
      typeof x !== "object" ||
      seen.has(x) ||
      (!Array.isArray(x) && Object.getPrototypeOf(x) !== Object.prototype)
    )
      throw Error("JSON value");
    seen.add(x);
    const keys = Reflect.ownKeys(x);
    const array = Array.isArray(x);
    if (array && keys.length !== x.length + 1) throw Error("JSON sparse array");
    for (const key of keys) {
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(x, key)!;
      if (
        typeof key !== "string" ||
        !d.enumerable ||
        !("value" in d) ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= x.length))
      )
        throw Error("JSON descriptor");
      visit(d.value, depth + 1);
    }
    seen.delete(x);
  }
  visit(value);
  return JSON.stringify(value);
}
export class IsolateHost implements Host {
  private versions = new Map<string, string>();
  private schemas = new Map<string, string>();
  schemaOf(p: Principal, version: string) {
    const s = this.schemas.get(json([p.tenant, version]));
    if (!s) throw Error("unknown version");
    return s;
  }
  active = 0;
  measurements: any[] = [];
  constructor(
    readonly limits: Limits = {
      deadlineMs: 1800,
      inputBytes: 65536,
      outputBytes: 65536,
      rssKillMiB: 256,
    },
    readonly capability?: CapabilityHandler,
  ) {}
  async deploy(p: Principal, version: string, source: string) {
    p = Object.freeze(JSON.parse(json(p)));
    if (Buffer.byteLength(source) > 262144) throw Error("source quota");
    const key = json([p.tenant, version]);
    if (this.versions.has(key)) throw Error("immutable version");
    let code;
    try {
      code = (
        await build({
          stdin: { contents: source, loader: "ts", sourcefile: "backend.ts" },
          bundle: true,
          write: false,
          format: "esm",
          platform: "browser",
          logLevel: "silent",
          plugins: [
            {
              name: "deny-imports",
              setup(b) {
                b.onResolve({ filter: /.*/ }, () => ({
                  errors: [
                    {
                      text: "backend must be a self-contained bundle; host filesystem imports forbidden",
                    },
                  ],
                }));
              },
            },
          ],
        })
      ).outputFiles[0].text;
    } catch {
      throw Error("build rejected");
    }
    const candidate = new IsolateHost(this.limits);
    candidate.versions.set(key, code);
    const metadata: any = await candidate.invoke(p, {
      version,
      field: "__validate",
      args: null,
    });
    const sdl = metadata?.typeDefs;
    if (typeof sdl !== "string") throw Error("schema rejected");
    try {
      const schema = buildSchema(sdl);
      if (validateSchema(schema).length || schema.getSubscriptionType())
        throw Error("schema invalid");
      const fields = [
        ...Object.keys(schema.getQueryType()?.getFields() ?? {}),
        ...Object.keys(schema.getMutationType()?.getFields() ?? {}),
      ];
      if (
        new Set(fields).size !== fields.length ||
        fields.some((f) => !metadata.fields.includes(f)) ||
        metadata.fields.some((f: string) => !fields.includes(f))
      )
        throw Error("schema manifest mismatch");
    } catch {
      throw Error("schema rejected");
    }
    if (this.versions.has(key)) throw Error("immutable version");
    this.versions.set(key, code);
    this.schemas.set(key, sdl);
  }
  async invoke(
    p: Principal,
    input: Invocation,
    signal?: AbortSignal,
  ): Promise<Json> {
    p = Object.freeze(JSON.parse(json(p)));
    input = JSON.parse(json(input));
    const backend = this.versions.get(json([p.tenant, input.version]));
    if (!backend) throw Error("unknown version");
    const payload = json(input);
    if (Buffer.byteLength(payload) > this.limits.inputBytes)
      throw Error("input quota");
    if (signal?.aborted) throw Error("cancelled");
    const dir = await mkdtemp(join(tmpdir(), "pg-isolate-"));
    const socket = join(dir, "s");
    let child: ReturnType<typeof spawn> | undefined;
    let timer: any, watch: any;
    let reason = "",
      peak = 0;
    let bridge: http.Server | undefined;
    const capabilityAbort = new AbortController();
    let capabilityAddress = "";
    let calls = 0;
    const start = performance.now();
    const kill = (why: string) => {
      if (!reason) reason = why;
      child?.kill("SIGKILL");
    };
    const cancel = () => kill("cancelled");
    try {
      if (this.capability) {
        bridge = http.createServer(async (req, res) => {
          try {
            if (++calls > 8) throw Error("capability quota");
            let bytes = 0;
            const chunks: Buffer[] = [];
            for await (const c of req) {
              bytes += c.length;
              if (bytes > this.limits.inputBytes) throw Error("input quota");
              chunks.push(c);
            }
            const result = await this.capability!(
              p,
              JSON.parse(Buffer.concat(chunks).toString()),
              capabilityAbort.signal,
            );
            const encoded = json(result);
            if (Buffer.byteLength(encoded) > this.limits.outputBytes)
              throw Error("output quota");
            res.end(encoded);
          } catch {
            res.writeHead(400);
            res.end("capability rejected");
          }
        });
        await new Promise<void>((resolve) =>
          bridge!.listen(0, "127.0.0.1", resolve),
        );
        capabilityAddress = "127.0.0.1:" + (bridge.address() as any).port;
      }
      await writeFile(join(dir, "backend.js"), backend);
      await writeFile(
        join(dir, "entry.js"),
        `import * as backend from './backend.js';export default {async fetch(req,env){try{const input=await req.json();if(input.field==='__validate'){if(!backend.schema||typeof backend.resolve!=='function'||Object.values(backend.schema).some(v=>typeof v!=='string'))return new Response('schema rejected',{status:400});return new Response(JSON.stringify({typeDefs:backend.typeDefs,fields:Object.keys(backend.schema)}))}if(!Object.hasOwn(backend.schema,input.field))return new Response('field rejected',{status:400});const value=await backend.resolve(input.field,input.args,Object.freeze(JSON.parse(env.PRINCIPAL)),Object.freeze({invoke:async(request)=>{if(!env.CAP)throw Error('capability unavailable');const r=await env.CAP.fetch('http://capability/',{method:'POST',body:(validate(request),JSON.stringify(request))});if(!r.ok)throw Error('capability rejected');return r.json()}}));function validate(x,seen=new Set(),depth=0){if(depth>64)throw Error('JSON depth');if(x===null||typeof x==='string'||typeof x==='boolean'||typeof x==='number'&&Number.isFinite(x))return;if(typeof x!=='object'||seen.has(x)||!Array.isArray(x)&&Object.getPrototypeOf(x)!==Object.prototype)throw Error('JSON');seen.add(x);const keys=Reflect.ownKeys(x),a=Array.isArray(x);if(a&&keys.length!==x.length+1)throw Error('JSON holes');for(const k of keys){if(a&&k==='length')continue;const d=Object.getOwnPropertyDescriptor(x,k);if(typeof k!=='string'||!d.enumerable||!('value'in d)||a&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=x.length))throw Error('JSON descriptor');validate(d.value,seen,depth+1)}seen.delete(x)}validate(value);const text=JSON.stringify(value);if(text===undefined)throw Error('output JSON');return new Response(text)}catch{return new Response('output rejected',{status:400})}}}`,
      );
      await writeFile(
        join(dir, "config.capnp"),
        `using Workerd = import "/workerd/workerd.capnp"; const config :Workerd.Config = (services = [(name="app",worker=(compatibilityDate="2026-10-01",modules=[(name="entry.js",esModule=embed "entry.js"),(name="backend.js",esModule=embed "backend.js")],bindings=[(name="PRINCIPAL",text=${JSON.stringify(json(p))})${this.capability ? ',(name="CAP",service="capability")' : ""}],globalOutbound="blocked")),(name="blocked",network=(allow=[]))${this.capability ? `,(name="capability",external=(address="${capabilityAddress}",http=()))` : ""}],sockets=[(name="main",address="unix:${socket}",http=(),service="app")]);`,
      );
      child = spawn(
        join(here, "node_modules/.bin/workerd"),
        ["serve", join(dir, "config.capnp")],
        {
          env: { PATH: process.env.PATH },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      this.active++;
      let errors = "";
      child.stderr!.on("data", (d) => {
        errors = (errors + d).slice(-1000);
      });
      timer = setTimeout(() => kill("deadline"), this.limits.deadlineMs);
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
      watch = setInterval(
        () =>
          execFile(
            "ps",
            ["-o", "rss=", "-p", String(child!.pid)],
            (err, stdout) => {
              if (!err) {
                peak = Math.max(peak, Number(stdout.trim()) / 1024);
                if (peak > this.limits.rssKillMiB) kill("memory");
              }
            },
          ),
        25,
      );
      const response = await new Promise<string>((resolve, reject) => {
        const attempt = () => {
          if (reason) return reject(Error(reason));
          if (child!.exitCode !== null || child!.signalCode)
            return reject(Error(reason || "runtime: " + errors));
          const req = http.request(
            {
              socketPath: socket,
              path: "/",
              method: "POST",
              headers: { "content-type": "application/json" },
            },
            (res) => {
              let bytes = 0;
              const chunks: Buffer[] = [];
              res.on("data", (c) => {
                bytes += c.length;
                if (bytes > this.limits.outputBytes) {
                  kill("output quota");
                  req.destroy(Error("output quota"));
                } else chunks.push(c);
              });
              res.on("end", () =>
                res.statusCode === 200
                  ? resolve(Buffer.concat(chunks).toString())
                  : reject(Error(Buffer.concat(chunks).toString())),
              );
              res.on("error", reject);
            },
          );
          req.on("error", (e: any) => {
            if (reason) reject(Error(reason));
            else if (e.code === "ENOENT" || e.code === "ECONNREFUSED")
              setTimeout(attempt, 15);
            else reject(e);
          });
          req.end(payload);
        };
        attempt();
      });
      const result = JSON.parse(response);
      json(result);
      return result;
    } finally {
      capabilityAbort.abort();
      bridge?.closeAllConnections();
      if (bridge)
        await new Promise<void>((resolve) => bridge!.close(() => resolve()));
      clearTimeout(timer);
      clearInterval(watch);
      signal?.removeEventListener("abort", cancel);
      if (child) {
        child.kill("SIGKILL");
        await new Promise<void>((resolve) => {
          if (child!.exitCode !== null || child!.signalCode) resolve();
          else child!.once("exit", () => resolve());
        });
        this.active--;
      }
      await rm(dir, { recursive: true, force: true });
      this.measurements.push({
        reason: reason || "complete",
        ms: Math.round(performance.now() - start),
        peakMiB: Math.round(peak),
      });
    }
  }
}
