import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
interface ComposeCall {
  args: string[];
  config: string;
  app?: string;
  backend?: string;
  sql?: string;
  processor?: string;
}
const revision = "a".repeat(40);
const stub = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');const name=path.basename(process.argv[1]),args=process.argv.slice(2);
if(name==='docker'){
 if(args[0]==='build')process.exit(0);
 const config=fs.readFileSync(args[args.indexOf('-f')+1],'utf8');
 fs.appendFileSync(process.env.CALL_LOG,JSON.stringify({args,config,app:process.env.PAGEGI_IMAGE,backend:process.env.PAGEGI_BACKEND_IMAGE,sql:process.env.PAGEGI_DATASET_SQL_IMAGE,processor:process.env.PAGEGI_IMAGE_PROCESSOR_IMAGE})+'\\n');
 if(args.includes('exec')){process.stdout.write('private-dump');process.exit(0);}
 if((process.env.FAIL_STAGE==='postgres'&&args.at(-1)==='postgres')||(process.env.FAIL_STAGE==='rollout'&&args.includes('--no-build')&&config==='new-composition\\n'))process.exit(17);
 process.exit(0);
}
if(name==='stat'){process.stdout.write(args[1]==='%g'?'1000':String(fs.statSync(args.at(-1)).size));process.exit(0);}
if(name==='install'){
 let a=[];for(let i=0;i<args.length;i++){if(['-o','-g'].includes(args[i]))i++;else a.push(args[i]);}
 if(a.includes('-d')){for(let i=0;i<a.length;i++)if(!a[i].startsWith('-')&&a[i-1]!=='-m')fs.mkdirSync(a[i],{recursive:true});}
 else {fs.copyFileSync(a.at(-2),a.at(-1));fs.chmodSync(a.at(-1),parseInt(a[a.indexOf('-m')+1],8));}process.exit(0);
}
process.exit(0);
`;
for (const failure of ["rollout", "postgres", "", "initial"]) {
  test(`isolated receiver ${failure ? `recovers from ${failure} failure` : "retains previous composition after success"}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "afv2-rollout-")),
      root = join(dir, "root"),
      bin = join(dir, "bin");
    try {
      mkdirSync(bin);
      mkdirSync(join(root, "releases", revision, "deploy"), {
        recursive: true,
      });
      mkdirSync(join(dir, "systemd"));
      mkdirSync(join(root, "dataset-attachments"));
      writeFileSync(
        join(root, "dataset-attachments", "retained"),
        "existing attachment",
      );
      const release = join(root, "releases", revision, "deploy");
      writeFileSync(
        join(release, "compose.artefactv2.yaml"),
        "new-composition\n",
      );
      writeFileSync(join(release, "init-artefactv2-database.sh"), "init\n");
      if (failure !== "initial")
        writeFileSync(join(root, "compose.yaml"), "old-composition\n");
      const pointers = {
        "current-image": "old-app",
        "current-backend-image": "old-backend",
        "current-dataset-sql-image": "old-sql",
        "current-image-processor-image": "old-processor",
      };
      for (const [name, value] of Object.entries(pointers))
        writeFileSync(join(root, name), value + "\n");
      writeFileSync(join(root, ".env"), "old-environment\n");
      for (const name of [
        "docker",
        "stat",
        "install",
        "flock",
        "systemctl",
        "iptables",
        "python3",
      ]) {
        writeFileSync(join(bin, name), stub);
        chmodSync(join(bin, name), 0o755);
      }
      const script = readFileSync("deploy/receive-artefactv2.sh", "utf8")
        .replace("root=/opt/artefactv2", `root=${root}`)
        .replaceAll("PATH=/usr/local/sbin:", `PATH=${bin}:/usr/local/sbin:`)
        .replace(
          "egress_script=/usr/local/sbin/artefactv2-sandbox-egress",
          `egress_script=${bin}/egress`,
        )
        .replace(
          "egress_unit=/etc/systemd/system/artefactv2-sandbox-egress.service",
          `egress_unit=${dir}/systemd/egress.service`,
        );
      const file = join(dir, "receive.sh"),
        log = join(dir, "calls");
      writeFileSync(file, script);
      const result = spawnSync("bash", [file, `deploy ${revision}`], {
        input: "archive",
        encoding: "utf8",
        env: {
          ...process.env,
          CALL_LOG: log,
          FAIL_STAGE: failure === "initial" ? "rollout" : failure,
        },
      });
      assert.equal(
        readFileSync(join(root, "dataset-attachments", "retained"), "utf8"),
        "existing attachment",
      );
      const calls = readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as ComposeCall);
      if (failure === "initial") {
        assert.equal(result.status, 17, result.stderr);
        assert.ok(!existsSync(join(root, "compose.yaml")));
        assert.equal(
          calls.filter((call) => call.args.includes("--no-build")).length,
          1,
        );
      } else if (failure) {
        assert.equal(result.status, 17, result.stderr);
        assert.equal(
          readFileSync(join(root, "compose.yaml"), "utf8"),
          "old-composition\n",
        );
        const rollback = calls.at(-1)!;
        assert.equal(rollback.config, "old-composition\n");
        assert.equal(rollback.app, "old-app");
        assert.equal(rollback.backend, "old-backend");
        assert.equal(rollback.sql, "old-sql");
        assert.equal(rollback.processor, "old-processor");
        for (const [name, value] of Object.entries(pointers))
          assert.equal(readFileSync(join(root, name), "utf8"), value + "\n");
        assert.equal(
          readFileSync(join(root, ".env"), "utf8"),
          "old-environment\n",
        );
      } else {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(
          readFileSync(join(root, "previous-compose.yaml"), "utf8"),
          "old-composition\n",
        );
        assert.equal(
          readFileSync(join(root, "compose.yaml"), "utf8"),
          "new-composition\n",
        );
        assert.equal(
          readFileSync(join(root, "current-dataset-sql-image"), "utf8"),
          `artefactv2-dataset-sql:${revision}\n`,
        );
      }
      if (!failure)
        assert.equal(
          readFileSync(join(root, "current-image-processor-image"), "utf8"),
          `artefactv2-image-processor:${revision}\n`,
        );
      assert.ok(
        !existsSync(join(root, "postgres-data")),
        "harness never touches a database volume",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
