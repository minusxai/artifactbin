#!/usr/bin/env python3
"""Private bounded rollout evidence. Never print container configuration or logs."""
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import time
from typing import TypedDict


class FailureReceipt(TypedDict):
    revision: str
    status: int
    services: list[dict]


def command(args: list[str], include_stderr: bool = False) -> str:
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT if include_stderr else subprocess.DEVNULL)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    output = bytearray()
    deadline = time.monotonic() + 6
    truncated = False
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise subprocess.TimeoutExpired(args, 6)
            chunk = os.read(process.stdout.fileno(), min(65536, 262144 - len(output)))
            if not chunk:
                break
            output.extend(chunk)
            if len(output) == 262144:
                truncated = True
                break
        if not truncated and process.wait(timeout=max(0.01, deadline - time.monotonic())):
            raise RuntimeError("diagnostic command failed")
        return output.decode("utf-8", errors="replace")
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()


def sanitize(text: str, secrets: list[str]) -> str:
    for secret in sorted(set(secrets), key=len, reverse=True):
        if len(secret) >= 6:
            text = text.replace(secret, "[REDACTED]")
            text = text.replace(json.dumps(secret)[1:-1], "[REDACTED]")
    text = re.sub(r"-----BEGIN [^-]+-----.*?-----END [^-]+-----", "[REDACTED PEM]", text, flags=re.S)
    text = re.sub(r"(?i)\b(?:postgres(?:ql)?|https?)://[^\s\"'<>]+", "[REDACTED URL]", text)
    text = re.sub(r"(?i)\bBearer\s+\S+", "Bearer [REDACTED]", text)
    return text


def redact(value, secrets: list[str]):
    if isinstance(value, str):
        return sanitize(value, secrets)
    if isinstance(value, list):
        return [redact(item, secrets) for item in value]
    if isinstance(value, dict):
        return {key: redact(item, secrets) for key, item in value.items()}
    return value


def capture(root: Path, revision: str, status: int, compose: list[str]) -> Path:
    receipt: FailureReceipt = {"revision": revision, "status": status, "services": []}
    for service in ("pagegi", "execution"):
        evidence: dict = {"service": service}
        try:
            ids = command(compose + ["ps", "-aq", service]).split()
            if len(ids) != 1:
                raise RuntimeError("container unavailable")
            container = json.loads(command(["docker", "inspect", ids[0]]))[0]
            secrets = [item.partition("=")[2] for item in container.get("Config", {}).get("Env", [])]
            # Secret-file values stay in memory and are never included in the receipt.
            mounts = container.get("Mounts", [])
            for item in container.get("Config", {}).get("Env", []):
                key, _, destination = item.partition("=")
                if key.endswith("_FILE"):
                    for mount in mounts:
                        if mount.get("Destination") == destination:
                            try:
                                secrets.append(Path(mount["Source"]).read_bytes()[:65536].decode().strip())
                            except (OSError, UnicodeError):
                                pass
            evidence["image"] = container.get("Config", {}).get("Image")
            state = container.get("State", {})
            evidence["state"] = {key: state.get(key) for key in ("Status", "Running", "ExitCode", "Error", "StartedAt", "FinishedAt")}
            health = state.get("Health", {})
            evidence["health"] = {"status": health.get("Status"), "log": health.get("Log", [])[-3:]}
            try:
                evidence["logs"] = command(["docker", "logs", "--tail", "100", "--since", "10m", ids[0]], include_stderr=True)
            except (OSError, RuntimeError, subprocess.TimeoutExpired):
                evidence["logsError"] = "Container logs unavailable"
            evidence = redact(evidence, secrets)
        except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired):
            evidence = {"service": service, "collectionError": "Diagnostic evidence unavailable"}
        receipt["services"].append(evidence)
    directory = root / "deploy-failures"
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    path = directory / f"{revision}-{time.time_ns()}.json"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(receipt, stream)
    return path


if __name__ == "__main__":
    capture(Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), sys.argv[4:])
