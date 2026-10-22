import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("failed rollout evidence is private, bounded, redacted and resilient to a missing sibling", () => {
  const dir = mkdtempSync(join(tmpdir(), "rollout-evidence-"));
  try {
    const docker = join(dir, "docker");
    const secretFile = join(dir, "secret");
    writeFileSync(secretFile, "file-secret-value");
    writeFileSync(
      docker,
      `#!${process.execPath}
const args=process.argv.slice(2);
if(args.includes('ps')){process.stdout.write(args.at(-1)==='pagegi'?'failed-id':'');}
else if(args[0]==='inspect'){process.stdout.write(JSON.stringify([{Config:{Env:['AUTH_TOKEN=environment-secret','EXECUTION_SECRET_FILE=${secretFile}']},Mounts:[{Destination:'${secretFile}',Source:'${secretFile}'}],State:{Status:'exited',ExitCode:1,Error:'environment-secret',Health:{Status:'unhealthy',Log:[{ExitCode:1,Output:'file-secret-value https://user:password@private.invalid/db'}]}}}]));}
else if(args[0]==='logs'){process.stdout.write('startup-error environment-secret file-secret-value Bearer bearer-secret '+ 'x'.repeat(300000));process.stderr.write('stderr-marker');}
`,
    );
    chmodSync(docker, 0o755);
    const result = spawnSync(
      "python3",
      [
        "deploy/capture-rollout-failure.py",
        dir,
        "a".repeat(40),
        "17",
        docker,
        "compose",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    const directory = join(dir, "deploy-failures");
    const files = readdirSync(directory);
    assert.equal(files.length, 1);
    const receiptFile = join(directory, files[0]!);
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(receiptFile).mode & 0o777, 0o600);
    const text = readFileSync(receiptFile, "utf8");
    assert.ok(text.length < 264000);
    assert.doesNotMatch(
      text,
      /environment-secret|file-secret-value|bearer-secret|user:password|private\.invalid/,
    );
    const receipt = JSON.parse(text);
    assert.equal(receipt.status, 17);
    assert.equal(receipt.services[0].health.status, "unhealthy");
    assert.match(receipt.services[0].logs, /startup-error/);
    assert.equal(
      receipt.services[1].collectionError,
      "Diagnostic evidence unavailable",
    );
    assert.equal(receipt.services[0].state.ExitCode, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("secret-file redaction reads at most 64 KiB from each mounted file", () => {
  const proof = spawnSync(
    "python3",
    [
      "-c",
      `
import importlib.util
import sys
sys.dont_write_bytecode=True
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location("capture", "deploy/capture-rollout-failure.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class BoundedFile:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self,limit):
  assert limit == 65536, "unbounded secret read"
  return b"bounded-secret"
class Receipt:
 def write(self,value):pass
 def __enter__(self):return self
 def __exit__(self,*args):pass
calls=[]
def command(args, **kwargs):
 if "ps" in args:return "container"
 if "inspect" in args:return '[{"Config":{"Env":["SECRET_FILE=/run/secret"]},"Mounts":[{"Destination":"/run/secret","Source":"/private/secret"}],"State":{}}]'
 return "bounded-secret"
def secret_open(path,*args,**kwargs):
 calls.append(str(path));return BoundedFile()
with patch.object(module,"command",command),patch.object(Path,"open",secret_open),patch.object(Path,"mkdir"),patch.object(Path,"chmod"),patch.object(module.os,"open",return_value=7),patch.object(module.os,"fdopen",return_value=Receipt()):
 module.capture(Path("/private/receipt"), "a"*40,17,["docker","compose"])
assert calls == ["/private/secret","/private/secret"]
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(proof.status, 0, proof.stderr);
});
