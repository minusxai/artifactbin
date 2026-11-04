// One process, one run. No native objects cross into the isolate.
import ivm from "isolated-vm";
import readline from "node:readline";
import { createDatabaseHost, DATABASE_OPERATION } from "./worker-database.mjs";
// stdout is the controller link: nothing may print to it (a driver's console default included).
for (const level of ["log", "info", "warn", "error", "debug", "trace"]) console[level] = () => {};
const pending = new Map();
let next = 0, isolate;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const invoke = (operation, args) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    send({ type: "call", id, operation, args });
});
const database = createDatabaseHost({ send, call: invoke });
/** Resolver code may name any host operation except the one that answers connection settings. */
const isolateInvoke = (operation, args) => {
    if (operation !== DATABASE_OPERATION) return invoke(operation, args);
    // Marked handled here: isolated-vm attaches its own handler after this returns.
    const refused = Promise.reject(Error("backend_capability_forbidden"));
    refused.catch(() => {});
    return refused;
};
readline
    .createInterface({ input: process.stdin })
    .on("close", () => process.exit(0))
    .on("line", async (line) => {
    const msg = JSON.parse(line);
    if (typeof msg.type === "string" && msg.type.startsWith("tunnel_")) {
        database.message(msg);
        return;
    }
    if (msg.type === "response") {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (p)
            msg.error ? p.reject(Error(msg.error)) : p.resolve(msg.value);
        return;
    }
    if (msg.type !== "run")
        return;
    try {
        isolate = new ivm.Isolate({ memoryLimit: msg.memoryMiB ?? 64 });
        const context = isolate.createContextSync();
        const reference = new ivm.Reference(isolateInvoke);
        const db = ["open", "query", "end"].map(name => new ivm.Reference(database[name]));
        context.evalSync("globalThis.window=globalThis;globalThis.self=globalThis;");
        context.evalClosureSync(`globalThis.__capabilities = (() => {
   const invoke=(op,args)=>$0.apply(undefined,[op,args],{arguments:{copy:true},result:{promise:true,copy:true}});
   const host=(ref,args)=>ref.apply(undefined,args,{arguments:{copy:true},result:{promise:true,copy:true}});
   return Object.freeze({ artifactbin:Object.freeze({read:args=>invoke('read',args),reply:args=>invoke('reply',args),call:(operation,args)=>invoke('artifactbin.'+operation,args)}),
     db:Object.freeze({open:name=>host($2,[name]),query:(id,sql,params)=>host($3,[id,sql,params]),end:id=>host($4,[id])}),
     emit:event=>invoke('emit',event),env:Object.freeze($1)});
 })();`, [reference, new ivm.ExternalCopy(msg.env ?? {}).copyInto(), ...db]);
        context.evalSync(msg.bundle, { timeout: msg.cpuMs ?? 1000 });
        const result = await context.evalClosure("return Program.default($0,globalThis.__capabilities)", [msg.input], {
            arguments: { copy: true },
            result: { promise: true, copy: true },
            timeout: msg.cpuMs ?? 1000,
        });
        send({
            type: "result",
            result,
            cpuMs: Number(isolate.cpuTime) / 1e6,
            wallMs: Number(isolate.wallTime) / 1e6,
        });
    }
    catch (error) {
        send({ type: "error", error: error.message });
    }
    finally {
        isolate?.dispose();
        isolate = undefined;
    }
});
send({ type: "ready" });
