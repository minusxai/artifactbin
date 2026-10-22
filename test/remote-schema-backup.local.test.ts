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
for (const failure of ["", "dump", "restore"])
  test(`remote backup ${failure || "success"} keeps verification honest and scope narrow`, () => {
    const dir = mkdtempSync(join(tmpdir(), "schema-backup-"));
    try {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const log = join(dir, "calls");
      const stub = `#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path'); const name=path.basename(process.argv[1]),args=process.argv.slice(2);fs.appendFileSync('${log}',JSON.stringify({name,args,hasPassword:!!process.env.PGPASSWORD})+'\\n');if(name==='pg_dump'&&args[0]==='--version'){process.stdout.write('pg_dump (PostgreSQL) 18.6');process.exit(0);}if(name==='pg_dump'){if('${failure}'==='dump')process.exit(1);process.stdout.write('archive');}if(name==='docker'&&args[0]==='run'&&'${failure}'==='restore'){process.stderr.write('private-host-and-password');process.exit(1);}`;
      for (const name of ["pg_dump", "docker"])
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
          (x) => x.name === "docker" && x.args[0] === "run",
        );
        assert.ok(run.args.includes("--network=none"));
        assert.ok(run.args.includes("--read-only"));
        assert.equal(run.args.includes("-v"), false);
        assert.equal(calls.at(-1).args[0], "rm");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
