import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const receive = readFileSync("deploy/receive.sh", "utf8");
const script = receive.match(/<<'EGRESS'\n([\s\S]*?)\nEGRESS\n/)?.[1];
assert.ok(script, "egress script is embedded in receive.sh");

// A fake iptables keeping rules as lines "<chain> <rule…>"; -C succeeds only for a present rule.
const fakeIptables = `#!/bin/sh
rules="$FAKE_RULES"; touch "$rules"; op=$1; chain=$2; shift 2; rule="$chain $*"
case $op in
  -N) grep -qx "chain $chain" "$rules" && exit 1; echo "chain $chain" >> "$rules" ;;
  -F) grep -v "^$chain " "$rules" > "$rules.t"; mv "$rules.t" "$rules" ;;
  -C) grep -qxF "$rule" "$rules" ;;
  -A|-I) echo "$rule" >> "$rules" ;;
  *) exit 2 ;;
esac
`;

test("the egress script is valid POSIX sh and applies the same rules idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "pagegi-egress-"));
  try {
    const egress = join(dir, "pagegi-sandbox-egress");
    writeFileSync(egress, script + "\n");
    writeFileSync(join(dir, "iptables"), fakeIptables);
    chmodSync(egress, 0o755);
    chmodSync(join(dir, "iptables"), 0o755);
    execFileSync("sh", ["-n", egress]);
    execFileSync("bash", ["-n", "deploy/receive.sh"]);
    const resolv = join(dir, "resolv.conf");
    writeFileSync(resolv, "nameserver 127.0.0.53\nnameserver 10.0.0.2\nnameserver fe80::1\n");
    const rules = join(dir, "rules");
    const env = { ...process.env, FAKE_RULES: rules, PAGEGI_SANDBOX_RESOLV_CONF: resolv };
    // The script sets its own PATH; run it with the fake first by prefixing PATH inside sh.
    const run = () =>
      execFileSync("sh", ["-c", `sed 's#^PATH=#PATH=${dir}:#' "$0" | sh`, egress], { env });
    run();
    const first = readFileSync(rules, "utf8");
    run();
    assert.equal(readFileSync(rules, "utf8").split("\n").sort().join("\n"), first.split("\n").sort().join("\n"));
    const chain = first.split("\n").filter((l) => l.startsWith("PAGEGI-SANDBOX "));
    assert.deepEqual(chain.slice(0, 2), [
      "PAGEGI-SANDBOX -d 10.0.0.2 -p udp --dport 53 -j RETURN",
      "PAGEGI-SANDBOX -d 10.0.0.2 -p tcp --dport 53 -j RETURN",
    ]);
    assert.equal(chain.length, 13);
    for (const net of ["10.0.0.0/8", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16"])
      assert.ok(chain.slice(2).includes(`PAGEGI-SANDBOX -d ${net} -j DROP`), net);
    const hooks = first.split("\n").filter((l) => /^(DOCKER-USER|INPUT) /.test(l));
    assert.deepEqual(hooks, ["DOCKER-USER -i pagegi-sbx -j PAGEGI-SANDBOX", "INPUT -i pagegi-sbx -j DROP"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
