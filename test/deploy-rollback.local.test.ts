import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { hostedRequest } from "../src/hosted-policy.ts";
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
import { runInNewContext } from "node:vm";
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
 if((['rollout','app-health','diagnostics'].includes(process.env.FAIL_STAGE)&&args.includes('--no-build')&&config==='new-composition\\n'))process.exit(17);
 process.exit(0);
}
if(name==='python3'&&args[0].endsWith('/capture-rollout-failure.py')){fs.writeFileSync(path.join(args[1],'diagnostics-order'),JSON.stringify({config:fs.readFileSync(path.join(args[1],'compose.yaml'),'utf8'),status:args[3],app:process.env.PAGEGI_IMAGE}));process.exit(process.env.FAIL_STAGE==='diagnostics'?19:0);}
if(name==='python3'&&args[0].endsWith('/backup-schema.py')){if(process.env.FAIL_STAGE==='backup')process.exit(17);fs.writeFileSync(args[2],'schema-backup');fs.writeFileSync(args[2]+'.verified','restore proof');process.exit(0);}
if(name==='stat'){process.stdout.write(args[1]==='%g'?'1000':String(fs.statSync(args.at(-1)).size));process.exit(0);}
if(name==='install'){
 let a=[];for(let i=0;i<args.length;i++){if(['-o','-g'].includes(args[i]))i++;else a.push(args[i]);}
 if(a.includes('-d')){for(let i=0;i<a.length;i++)if(!a[i].startsWith('-')&&a[i-1]!=='-m')fs.mkdirSync(a[i],{recursive:true});}
 else {fs.copyFileSync(a.at(-2),a.at(-1));fs.chmodSync(a.at(-1),parseInt(a[a.indexOf('-m')+1],8));}process.exit(0);
}
process.exit(0);
`;
for (const failure of [
  "rollout",
  "app-health",
  "backup",
  "diagnostics",
  "",
  "initial",
]) {
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
        "previous-image": "retained-app",
        "previous-backend-image": "retained-backend",
        "previous-dataset-sql-image": "retained-sql",
        "previous-image-processor-image": "retained-processor",
      };
      for (const [name, value] of Object.entries(pointers))
        writeFileSync(join(root, name), value + "\n");
      writeFileSync(join(root, ".env"), "old-environment\n");
      writeFileSync(
        join(root, "previous-compose.yaml"),
        "retained-composition\n",
      );
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
      if (failure) {
        assert.deepEqual(
          JSON.parse(readFileSync(join(root, "diagnostics-order"), "utf8")),
          {
            config: "new-composition\n",
            status: "17",
            ...(failure === "backup" ? {} : { app: `artefactv2:${revision}` }),
          },
          "capture observes failed composition before rollback replaces it",
        );
      } else assert.equal(existsSync(join(root, "diagnostics-order")), false);
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
        if (failure === "app-health") {
          assert.equal(
            calls.length,
            2,
            "app started under compose wait before health failure and rollback",
          );
          assert.equal(calls[0]!.app, `artefactv2:${revision}`);
          assert.equal(calls[0]!.config, "new-composition\n");
          assert.ok(calls[0]!.args.includes("--wait"));
        }
        assert.equal(
          readFileSync(join(root, "previous-compose.yaml"), "utf8"),
          "retained-composition\n",
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

test("application health probe requires exact healthy JSON and HTTP200 before Compose can publish rollout", async () => {
  const compose = readFileSync("deploy/compose.artefactv2.yaml", "utf8");
  const app = compose.split("  pagegi:\n")[1]!.split("\n  execution:")[0]!;
  const encoded = app.match(/test: \['CMD', 'node', '-e', (".*")\]/)?.[1];
  assert.ok(encoded, "application has a health probe used by compose --wait");
  const probe = JSON.parse(encoded) as string;
  const check = async (
    status: number,
    body: unknown,
    failure?: "json" | "network",
  ) => {
    let exit: number | undefined;
    runInNewContext(probe, {
      URL,
      process: {
        env: { PAGEGI_PLATFORM_ORIGIN: "https://platform.invalid" },
        exit: (code: number) => {
          exit = code;
        },
      },
      require: (name: string) => {
        assert.equal(name, "node:http");
        return {
          get: (
            url: string,
            options: { headers: { Host: string } },
            receive: (response: unknown) => void,
          ) => {
            assert.equal(url, "http://127.0.0.1:8787/health");
            assert.equal(options.headers.Host, "platform.invalid");
            const req = {
              setTimeout: (ms: number, _expired: () => void) => {
                assert.equal(ms, 4000);
              },
              destroy() {},
              on: (event: string, listener: () => void) => {
                if (event === "error" && failure === "network") listener();
              },
            };
            const callbacks: Record<string, (chunk?: string) => void> = {};
            queueMicrotask(() => {
              if (failure === "network") return;
              receive({
                statusCode: status,
                on: (event: string, callback: (chunk?: string) => void) => {
                  callbacks[event] = callback;
                },
              });
              callbacks.data!(
                failure === "json" ? "invalid-json" : JSON.stringify(body),
              );
              callbacks.end!();
            });
            return req;
          },
        };
      },
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    return exit;
  };
  assert.equal(await check(200, { ok: true }), 0);
  for (const status of [201, 204, 301, 302, 307, 308, 500, 503])
    assert.equal(await check(status, { ok: true }), 1, `HTTP${status}`);
  for (const body of [
    null,
    [],
    {},
    { ok: false },
    { ok: "true" },
    { ok: true, other: "stale" },
  ])
    assert.equal(await check(200, body), 1);
  for (const failure of ["json", "network"] as const)
    assert.equal(await check(200, { ok: true }, failure), 1, failure);
});

test("application probe reaches health through the production host boundary", async () => {
  const compose = readFileSync("deploy/compose.artefactv2.yaml", "utf8");
  const app = compose.split("  pagegi:\n")[1]!.split("\n  execution:")[0]!;
  const probe = JSON.parse(
    app.match(/test: \['CMD', 'node', '-e', (".*")\]/)![1]!,
  ) as string;
  const hosts: string[] = [];
  const server = createServer((req, res) => {
    hosts.push(req.headers.host!);
    try {
      hostedRequest(req.headers.host!, 0, {
        platformOrigin: "https://platform.invalid",
        runnerOrigin: "https://{document}.runner.invalid",
      });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(403);
      res.end(JSON.stringify({ error: "Invalid host" }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["-e", probe.replace("127.0.0.1:8787", `127.0.0.1:${address.port}`)],
        {
          env: {
            ...process.env,
            PAGEGI_PLATFORM_ORIGIN: "https://platform.invalid",
          },
          stdio: "ignore",
        },
      );
      child.once("error", reject);
      child.once("exit", resolve);
    });
    assert.equal(code, 0);
    assert.deepEqual(hosts, ["platform.invalid"]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
