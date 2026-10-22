import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

for (const namespace of ["pagegi", "artefactv2"]) {
  const receiver =
    namespace === "pagegi"
      ? "deploy/receive.sh"
      : "deploy/receive-artefactv2.sh";
  const receive = readFileSync(receiver, "utf8");
  const chainName =
    namespace === "pagegi" ? "PAGEGI-SANDBOX" : "ARTEFACTV2-SANDBOX";
  const bridge = namespace === "pagegi" ? "pagegi-sbx" : "artefactv2-sb";
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

  test(`${namespace} egress applies isolated rules idempotently`, () => {
    const dir = mkdtempSync(join(tmpdir(), "pagegi-egress-"));
    try {
      const egress = join(dir, "pagegi-sandbox-egress");
      writeFileSync(egress, script + "\n");
      writeFileSync(join(dir, "iptables"), fakeIptables);
      writeFileSync(join(dir, "ip6tables"), `#!/bin/sh
[ "\${FAKE_IPV6_FAIL:-}" != 1 ] || exit 2
FAKE_RULES="$FAKE_IPV6_RULES" exec "${dir}/iptables" "$@"
`);
      chmodSync(join(dir, "ip6tables"), 0o755);
      chmodSync(egress, 0o755);
      chmodSync(join(dir, "iptables"), 0o755);
      execFileSync("sh", ["-n", egress]);
      execFileSync("bash", ["-n", receiver]);
      const resolv = join(dir, "resolv.conf");
      writeFileSync(
        resolv,
        "nameserver 127.0.0.53\nnameserver 10.0.0.2\nnameserver fe80::1\n",
      );
      const rules = join(dir, "rules");
      const ipv6Rules = join(dir, "ipv6-rules");
      const unrelatedIPv6 = "INPUT -i unrelated-bridge -j ACCEPT\nFORWARD -i old-sandbox -j ACCEPT\n";
      writeFileSync(ipv6Rules, unrelatedIPv6);
      const env = {
        ...process.env,
        FAKE_RULES: rules,
        FAKE_IPV6_RULES: ipv6Rules,
        PAGEGI_SANDBOX_RESOLV_CONF: resolv,
      };
      // The script sets its own PATH; run it with the fake first by prefixing PATH inside sh.
      const run = () =>
        execFileSync(
          "sh",
          ["-c", `sed 's#^PATH=#PATH=${dir}:#' "$0" | sh`, egress],
          { env },
        );
      run();
      const first = readFileSync(rules, "utf8");
      const firstIPv6 = readFileSync(ipv6Rules, "utf8");
      run();
      assert.equal(
        readFileSync(rules, "utf8").split("\n").sort().join("\n"),
        first.split("\n").sort().join("\n"),
      );
      assert.equal(readFileSync(ipv6Rules, "utf8"), firstIPv6, "IPv6 rules are idempotent");
      assert.equal(firstIPv6, unrelatedIPv6 + (namespace === "artefactv2"
        ? "INPUT -i artefactv2-sb -j DROP\nFORWARD -i artefactv2-sb -j DROP\n"
        : ""), "only the new sandbox bridge receives the IPv6 backstop");
      if (namespace === "artefactv2")
        assert.throws(() => execFileSync("sh", ["-c", `sed 's#^PATH=#PATH=${dir}:#' "$0" | sh`, egress],
          { env: { ...env, FAKE_IPV6_FAIL: "1" }, stdio: "pipe" }),
          "missing or failed IPv6 enforcement refuses firewall setup");
      const chain = first
        .split("\n")
        .filter((l) => l.startsWith(chainName + " "));
      assert.deepEqual(chain.slice(0, 2), [
        `${chainName} -d 10.0.0.2 -p udp --dport 53 -j RETURN`,
        `${chainName} -d 10.0.0.2 -p tcp --dport 53 -j RETURN`,
      ]);
      assert.equal(chain.length, 13);
      for (const net of [
        "10.0.0.0/8",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.168.0.0/16",
      ])
        assert.ok(
          chain.slice(2).includes(`${chainName} -d ${net} -j DROP`),
          net,
        );
      const hooks = first
        .split("\n")
        .filter((l) => /^(DOCKER-USER|INPUT) /.test(l));
      assert.deepEqual(hooks, [
        `DOCKER-USER -i ${bridge} -j ${chainName}`,
        `INPUT -i ${bridge} -j DROP`,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
