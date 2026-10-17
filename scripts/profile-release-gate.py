#!/usr/bin/env python3
"""Profile the exact configured release commands without issuing approval.

Use --baseline to disable fixture reuse, retaining the identical assertions.
Like the release validator, stop immediately on the first failing command.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baseline", action="store_true")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    environment = dict(os.environ, EVEXIA_RELEASE_PROFILE=str(output / "commands.jsonl"))
    # Match release-validation.yml rather than relying on unittest import order.
    environment["PYTHONPATH"] = str(ROOT / "artifacts/api-server/backend") + (
        os.pathsep + environment["PYTHONPATH"] if environment.get("PYTHONPATH") else "")
    environment["EVEXIA_DISABLE_FIXTURE_CACHE"] = "1" if args.baseline else "0"
    policy = json.loads((ROOT / "scripts/release-authorization-policy.json").read_text())
    results = []
    start = time.monotonic()
    for command in policy["validation_commands"]:
        began = time.monotonic()
        result = subprocess.run(command, cwd=ROOT, env=environment)
        results.append({
            "command": command, "seconds": round(time.monotonic() - began, 3),
            "returncode": result.returncode,
        })
        report = {
            "mode": "baseline" if args.baseline else "optimized",
            "seconds": round(time.monotonic() - start, 3), "commands": results,
            "complete": len(results) == len(policy["validation_commands"]) and not result.returncode,
        }
        (output / "summary.json").write_text(json.dumps(report, indent=2) + "\n")
        if result.returncode:
            return result.returncode
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
