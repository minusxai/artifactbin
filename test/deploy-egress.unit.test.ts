import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const receive = readFileSync("deploy/receive.sh", "utf8");
function heredoc(marker: string): string {
  const body = receive.match(new RegExp(`<<'${marker}'\\n([\\s\\S]*?)\\n${marker}\\n`))?.[1];
  assert.ok(body, `${marker} heredoc exists`);
  return body;
}

test("the egress unit reapplies the rules at boot and after Docker restarts", () => {
  const unit = heredoc("UNIT");
  for (const line of [
    "After=docker.service network-online.target",
    "Wants=network-online.target",
    "PartOf=docker.service",
    "Type=oneshot",
    "RemainAfterExit=yes",
    "ExecStart=/usr/local/sbin/pagegi-sandbox-egress",
    "WantedBy=multi-user.target docker.service",
  ])
    assert.match(unit, new RegExp(`^${line.replace(/[.]/g, "\\.")}$`, "m"), line);
});

test("every deployment installs, enables and runs the egress script", () => {
  const install = receive.indexOf('install -o root -g root -m 0755 "$egress_tmp" "$egress_script"');
  const enable = receive.indexOf("systemctl daemon-reload && systemctl enable --now pagegi-sandbox-egress.service");
  const run = receive.indexOf('\n"$egress_script"\n');
  const compose = receive.indexOf('"${compose[@]}" up -d --wait');
  assert.ok(install > 0 && install < enable && enable < run && run < compose);
  assert.match(receive, /^egress_script=\/usr\/local\/sbin\/pagegi-sandbox-egress$/m);
  assert.match(receive, /^egress_unit=\/etc\/systemd\/system\/pagegi-sandbox-egress\.service$/m);
  const script = heredoc("EGRESS");
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.match(script, /\/run\/systemd\/resolve\/resolv\.conf/);
});
