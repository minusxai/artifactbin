import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
for (const failure of ["", "dump", "restore", "restore-once"])
  test(`remote backup ${failure || "success"} keeps verification honest and scope narrow`, () => {
    const dir = mkdtempSync(join(tmpdir(), "schema-backup-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const log = join(dir, "calls");
      const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const name=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync('${log}',JSON.stringify({name,args,hasPassword:!!process.env.PGPASSWORD})+'\\n');
const stateFile='${dir}/state';let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):{};
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state));
if(name==='pg_dump'&&args[0]==='--version'){process.stdout.write('pg_dump (PostgreSQL) 18.6');process.exit(0);}
if(name==='psql'){process.stdout.write('1024');process.exit(0);}
if(name==='pg_dump'){if('${failure}'==='dump')process.exit(1);process.stdout.write('archive');process.exit(0);}
if(name==='docker'){
 const volume=args[0]==='volume',op=volume?args[1]:args[0],key=args.at(-1);
 if(op==='create'){const token=args[args.indexOf('--label',args.indexOf('--label')+1)+1].split('=')[1];state[key]={Labels:{'pagegi.backup-proof-job':token}};save();process.stdout.write(key);process.exit(0);}
 if(op==='inspect'){if(!state[key]){process.stderr.write('No such '+(volume?'volume':'container'));process.exit(1);}process.stdout.write(JSON.stringify([state[key]]));process.exit(0);}
 if(op==='rm'){delete state[key];save();process.exit(0);}
 if(op==='run'){const container=args[args.indexOf('--name')+1],token=args[args.indexOf('--label',args.indexOf('--label')+1)+1].split('=')[1];state[container]={Config:{Labels:{'pagegi.backup-proof-job':token}}};save();if(container.endsWith('-probe'))process.stdout.write(args.at(-1).startsWith('du ')?'1024':'1073741824');else if('${failure}'==='restore'||('${failure}'==='restore-once'&&!state.restoreFailed)){state.restoreFailed=true;save();process.stderr.write('private-host-and-password');process.exit(1);}process.exit(0);}
}
`;
      for (const name of ["pg_dump", "psql", "docker"])
        writeFileSync(join(bin, name), stub, { mode: 0o755 });
      const config = join(dir, "private.env"),
        output = join(dir, "backup.dump");
      writeFileSync(
        config,
        "PGHOST=private.invalid\nPGUSER=backup_role\nPGDATABASE=shared\nPGPASSWORD=synthetic-secret\nPGSSLMODE=verify-full\nPGSSLROOTCERT=/private/public-ca.pem\n",
        { mode: 0o600 },
      );
      const result = spawnSync(
        "python3",
        [resolve("deploy/backup-schema.py"), config, output],
        {
          env: { ...process.env, PATH: bin + ":" + process.env.PATH },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, failure ? 1 : 0, result.stderr);
      assert.equal(result.stderr.includes("private-host"), false);
      assert.equal(result.stderr.includes("synthetic-secret"), false);
      assert.equal(existsSync(output + ".verified"), !failure);
      assert.equal(existsSync(output), !failure);
      assert.equal(existsSync(output + ".tmp"), false);
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((x) => JSON.parse(x));
      const dump = calls.find(
        (x) => x.name === "pg_dump" && x.args[0] !== "--version",
      );
      assert.ok(dump.args.includes("--schema=artefactv2"));
      assert.ok(dump.args.includes("--schema=artefactv2_migration"));
      assert.equal(dump.hasPassword, true);
      for (const call of calls.filter((x) => x.name === "docker")) {
        assert.equal(call.hasPassword, false);
        assert.equal(call.args.join(" ").includes("synthetic-secret"), false);
      }
      if (failure !== "dump") {
        const run = calls.find(
          (x) =>
            x.name === "docker" &&
            x.args[0] === "run" &&
            !x.args[x.args.indexOf("--name") + 1].endsWith("-probe"),
        );
        assert.ok(run.args.includes("--network=none"));
        assert.ok(run.args.includes("--read-only"));
        assert.equal(run.args[run.args.indexOf("--cpus") + 1], "4");
        assert.equal(run.args[run.args.indexOf("--memory") + 1], "2048m");
        assert.equal(run.args[run.args.indexOf("--memory-swap") + 1], "2048m");
        const proof = run.args[run.args.indexOf("-c") + 1];
        assert.match(
          proof,
          /pg_restore .*--jobs=4 .*--exit-on-error --no-owner --no-privileges \/proof\/archive\.dump/,
        );
        assert.doesNotMatch(
          proof,
          /--(?:table|exclude|schema-only|data-only|section|use-list)\b/,
        );
        assert.equal(run.args.includes("-v"), false);
        assert.ok(
          run.args.some((v: string) =>
            v.startsWith("type=volume,source=pagegi-backup-proof-"),
          ),
        );
        assert.equal(calls.at(-1).args[1], "inspect");
        if (!failure) {
          const receipt = JSON.parse(
            readFileSync(output + ".verified", "utf8"),
          );
          assert.deepEqual(Object.keys(receipt.stageSeconds).sort(), [
            "cleanup",
            "dump",
            "prepare",
            "restore",
            "total",
          ]);
          assert.ok(
            Object.values(receipt.stageSeconds).every(
              (value) =>
                typeof value === "number" &&
                Number.isFinite(value) &&
                value >= 0,
            ),
          );
        }
        if (failure === "restore-once") {
          const retried = spawnSync(
            "python3",
            [resolve("deploy/backup-schema.py"), config, output],
            {
              env: { ...process.env, PATH: bin + ":" + process.env.PATH },
              encoding: "utf8",
            },
          );
          assert.equal(retried.status, 0, retried.stderr);
          assert.equal(existsSync(output + ".verified"), true);
          assert.equal(existsSync(output + ".tmp"), false);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
