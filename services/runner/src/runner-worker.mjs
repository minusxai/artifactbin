// One process, one run. No native objects cross into the isolate.
import ivm from "isolated-vm";
import readline from "node:readline";
const pending = new Map();
let next = 0, isolate;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const invoke = (operation, args) => new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    send({ type: "call", id, operation, args });
});
readline
    .createInterface({ input: process.stdin })
    .on("close", () => process.exit(0))
    .on("line", async (line) => {
    const msg = JSON.parse(line);
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
        const reference = new ivm.Reference(invoke);
        context.evalSync("globalThis.window=globalThis;globalThis.self=globalThis;");
        context.evalClosureSync(`globalThis.__capabilities = (() => {
   const invoke=(op,args)=>$0.apply(undefined,[op,args],{arguments:{copy:true},result:{promise:true,copy:true}});
   return Object.freeze({ artifactbin:Object.freeze({read:args=>invoke('read',args),reply:args=>invoke('reply',args),call:(operation,args)=>invoke('artifactbin.'+operation,args)}),
     ai:Object.freeze({open:args=>invoke('ai.open',args),next:args=>invoke('ai.next',args)}),
     emit:event=>invoke('emit',event),env:Object.freeze($1)});
 })();`, [reference, new ivm.ExternalCopy(msg.env ?? {}).copyInto()]);
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
