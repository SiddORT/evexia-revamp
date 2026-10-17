#!/usr/bin/env python3
"""Required bounded local checks; the production/CI release gate is unchanged."""
import argparse
import fcntl
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import tomllib

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "test-results/local-release"
HARNESS = "scripts/run-authenticated-previews.sh"
# Keep credential-consuming workflows and all-engine matrices in their own
# fixtures, just as on the unsplit path. Roles includes both original passes.
SEPARATE = {
    "roles-permissions", "role-lifecycle", "mrs-backend", "mr-workspace",
    "sales-targets-backend", "opening-balances-backend",
    "master-staff-permissions", "directory-deletion", "patients-backend",
    "orders-navigation", "patients-layout", "download-logs",
}


def command(argv, environment=None):
    return {"argv": argv, "environment": environment or {}}


def default_specs():
    source = (ROOT / HARNESS).read_text()
    start = source.index('if [ "$#" -gt 0 ]; then\n  SPECS=')
    end = source.index('echo "Running authenticated browser', start)
    specs = []
    for value in re.findall(r'^\s*SPECS="([^"]*)"\s*$', source[start:end], re.M):
        if value == "$*":
            continue
        specs.extend(shlex.split(value.removeprefix("$SPECS ")))
    if not specs:
        raise ValueError("Cannot partition the default preview selection")
    return specs


def preview_groups(specs):
    if not specs or len(specs) != len(set(specs)):
        raise ValueError("Default preview list must be nonempty and unique")
    primary, separate = [], []
    for spec in specs:
        if not (ROOT / spec).is_file() or not spec.endswith(".preview.spec.mjs"):
            raise ValueError(f"Invalid preview spec: {spec}")
        name = Path(spec).name.removesuffix(".preview.spec.mjs")
        (separate if name in SEPARATE else primary).append(spec)
    groups = [primary[i:i + 4] for i in range(0, len(primary), 4)]
    groups.extend([[spec] for spec in separate])
    if sorted(spec for group in groups for spec in group) != sorted(specs):
        raise ValueError("Preview partition omitted or repeated a spec")
    return groups


def plan():
    services, stages = [], []
    for line in (ROOT / "scripts/validate-template-preferences.sh").read_text().splitlines():
        tokens = shlex.split(line, comments=True)
        environment = {}
        while tokens and "=" in tokens[0] and not tokens[0].startswith("run"):
            key, value = tokens.pop(0).split("=", 1)
            environment[key] = value
        if not tokens or tokens[0] != "run":
            continue
        argv = tokens[1:]
        entry = command(argv, environment)
        if argv[:2] == ["sh", "scripts/test-api-foundation.sh"]:
            stages.append({"name": "api-" + Path(argv[2]).stem.removeprefix("test_").replace("_", "-"),
                           "commands": [entry]})
        elif argv == ["sh", HARNESS]:
            specs = default_specs()
            for i, group in enumerate(preview_groups(specs), 1):
                stages.append({"name": f"browser-{i:02}", "commands": [command(["sh", HARNESS, *group])]})
        elif argv[:2] == ["sh", HARNESS]:
            stages.append({"name": "browser-" + Path(argv[2]).name.split(".")[0], "commands": [entry]})
        else:
            services.append(entry)
    policy = json.loads((ROOT / "scripts/release-authorization-policy.json").read_text())
    if policy["validation_commands"][0] != ["pnpm", "run", "validate:release"]:
        raise ValueError("Release policy changed; explicitly update the local partition")
    stages = [{"name": "services", "commands": services}] + stages
    stages.extend({"name": f"policy-{i:02}", "commands": [command(argv)]}
                  for i, argv in enumerate(policy["validation_commands"][1:], 2))
    if not services or len({stage["name"] for stage in stages}) != len(stages):
        raise ValueError("Empty or duplicate release stages")
    return stages


def source_key():
    """Do not combine results from different code, dependencies or test inputs."""
    paths = subprocess.check_output(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=ROOT
    ).decode().split("\0")
    digest = hashlib.sha256()
    suffixes = {".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".json",
                ".yaml", ".yml", ".sh", ".toml", ".lock", ".txt", ".css", ".html"}
    for name in sorted(set(paths)):
        path = ROOT / name
        if name.startswith((".agents/", ".local/", "docs/", "attached_assets/")):
            continue
        if path.is_file() and (path.suffix in suffixes or path.name == "pnpm-lock.yaml"):
            digest.update(name.encode() + b"\0" + path.read_bytes() + b"\0")
    digest.update(json.dumps(sorted((d.metadata["Name"], d.version)
                                    for d in importlib.metadata.distributions())).encode())
    for binary in ("python3", "pg_ctl", "initdb"):
        digest.update(os.path.realpath(shutil.which(binary) or "").encode())
    installed_lock = ROOT / "node_modules/.pnpm/lock.yaml"
    if installed_lock.is_file():
        digest.update(installed_lock.read_bytes())
    return digest.hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def prepare():
    STATE.mkdir(parents=True, exist_ok=True)
    if (STATE / "session.json").exists():
        old = json.loads((STATE / "session.json").read_text())
        old_root = Path(old["cache"])
        if old_root.parent == Path("/tmp") and old_root.name.startswith("evexia-release-cache."):
            shutil.rmtree(old_root, ignore_errors=True)
    for path in STATE.glob("*.result.json"):
        path.unlink()
    cache = tempfile.mkdtemp(prefix="evexia-release-cache.", dir="/tmp")
    session = {"source": source_key(), "cache": cache, "stages": plan()}
    write_json(STATE / "session.json", session)
    print(f"Prepared {len(session['stages'])} required local stages; no test results reused.")


def session():
    data = json.loads((STATE / "session.json").read_text())
    if data["source"] != source_key() or data["stages"] != plan():
        raise ValueError("Test code/dependencies changed: prepare a new session and rerun every stage")
    if not Path(data["cache"]).is_dir():
        raise ValueError("Private cache disappeared: prepare a new session and rerun every stage")
    return data


def run(name):
    data = session()
    stage = next((s for s in data["stages"] if s["name"] == name), None)
    if stage is None:
        raise ValueError(f"Unknown required stage: {name}")
    result_path = STATE / f"{name}.result.json"
    result_path.unlink(missing_ok=True)  # An interrupted retry cannot retain an old pass.
    environment = dict(os.environ, EVEXIA_TEST_CACHE_ROOT=data["cache"],
                       EVEXIA_RELEASE_PROFILE=str(STATE / "timing.jsonl"))
    backend = str(ROOT / "artifacts/api-server/backend")
    environment["PYTHONPATH"] = backend + os.pathsep + environment.get("PYTHONPATH", "")
    start = time.monotonic()
    code = 0
    with (STATE / f"{name}.log").open("wb") as log:
        for entry in stage["commands"]:
            print("LOCAL_RELEASE", name, shlex.join(entry["argv"]), flush=True)
            process = subprocess.Popen(entry["argv"], cwd=ROOT,
                                       env=dict(environment, **entry["environment"]),
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            try:
                for line in process.stdout:
                    log.write(line)
                    log.flush()
                    sys.stdout.buffer.write(line)
                    sys.stdout.buffer.flush()
                code = process.wait()
            finally:
                process.stdout.close()
                if process.poll() is None:
                    process.terminate()
                    process.wait()
            if code:
                break
    if data["source"] != source_key():
        raise ValueError("Test inputs changed during execution; no passing receipt recorded")
    receipt = {"name": name, "source": data["source"], "returncode": code,
               "seconds": round(time.monotonic() - start, 3)}
    write_json(result_path, receipt)
    print(json.dumps(receipt))
    return code


def verify():
    data = session()
    results = []
    for stage in data["stages"]:
        result = json.loads((STATE / f"{stage['name']}.result.json").read_text())
        if result["source"] != data["source"] or result["returncode"]:
            raise ValueError(f"Missing/current passing result required: {stage['name']}")
        results.append(result)
    combined = b"\n".join((STATE / f"{s['name']}.log").read_bytes() for s in data["stages"])
    (STATE / "complete.log").write_bytes(combined)
    summary = {"complete": True, "source": data["source"], "stages": results,
               "seconds": round(sum(r["seconds"] for r in results), 3)}
    write_json(STATE / "summary.json", summary)
    print(json.dumps(summary, indent=2))


def audit(*, without_browser=False):
    """Independent of scheduling order; every execution remains a required check."""
    workflows = tomllib.loads((ROOT / ".replit").read_text())["workflows"]["workflow"]
    configured = {w["name"]: w for w in workflows}
    expected = {
        ("release" if stage["name"] == "services" else "release-" + stage["name"]):
        "python3 -B scripts/local-release-checks.py run " + stage["name"]
        for stage in plan()
        if not (without_browser and stage["name"].startswith("browser-"))
    }
    expected["release-coverage"] = ("python3 -B scripts/local-release-checks.py audit"
                                  + (" --without-browser" if without_browser else ""))
    for name, argv in expected.items():
        workflow = configured.get(name, {})
        if (workflow.get("metadata", {}).get("isValidation") is not True
                or workflow.get("tasks") != [{"task": "shell.exec", "args": argv}]):
            raise ValueError(f"Required validation missing or changed: {name}")
    print(f"All {len(expected)} required checks are registered with exact commands.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "prepare", "run", "verify", "audit"])
    parser.add_argument("stage", nargs="?")
    parser.add_argument("--without-browser", action="store_true",
                        help="Audit only the user-selected local non-browser checks; CI stays full")
    args = parser.parse_args()
    if args.without_browser and args.action != "audit":
        parser.error("--without-browser is only valid for the local registration audit")
    if args.action == "plan":
        print(json.dumps(plan(), indent=2))
        return 0
    if args.action == "audit":
        audit(without_browser=args.without_browser)
        return 0
    STATE.mkdir(parents=True, exist_ok=True)
    started_key = source_key()
    # Separate validations may be scheduled together. Never overlap real browser
    # workloads or mutate session receipts while another stage is executing.
    with (STATE / "execution.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if started_key != source_key():
            raise ValueError("Test inputs changed while queued; rerun this stage")
        if args.action == "prepare":
            prepare()
        elif args.action == "verify":
            verify()
        elif not args.stage:
            parser.error("run requires a stage")
        else:
            # Validation services can schedule any check first. The first lock
            # owner initializes once for this source; never assume services won.
            try:
                session()
            except (ValueError, FileNotFoundError):
                prepare()
            return run(args.stage)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, FileNotFoundError) as error:
        sys.exit(f"LOCAL_RELEASE_INCOMPLETE: {error}")
