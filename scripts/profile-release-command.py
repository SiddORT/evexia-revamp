#!/usr/bin/env python3
"""Time a release command without changing its arguments or exit status."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--elapsed-since", type=float)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command[:1] == ["--"]:
        command = command[1:]
    if args.elapsed_since is not None:
        if command:
            parser.error("elapsed timing cannot also run a command")
        start, returncode = args.elapsed_since, 0
    else:
        if not command:
            parser.error("a command is required")
        start = time.monotonic()
        returncode = subprocess.run(command).returncode
    record = json.dumps({
        "label": args.label, "seconds": round(time.monotonic() - start, 3),
        "returncode": returncode,
    }) + "\n"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        os.write(fd, record.encode())
    finally:
        os.close(fd)
    print(f"RELEASE_TIMING {record.strip()}", file=sys.stderr, flush=True)
    return returncode if returncode >= 0 else 128 - returncode


if __name__ == "__main__":
    raise SystemExit(main())
