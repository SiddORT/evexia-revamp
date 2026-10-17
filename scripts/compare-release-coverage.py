#!/usr/bin/env python3
"""Compare completed release logs; fail if original suite counts differ.

This supplements (does not replace) unchanged spec/assertion source and zero
exit statuses. Timing differences and extra cache-isolation checks are ignored.
"""
import argparse
import json
from pathlib import Path
import re


def inventory(path):
    text = re.sub(r"\x1b\[[0-9;]*m", "", path.read_text())
    patterns = {
        "node": r"^ℹ tests (\d+)$",
        "pytest": r"^(\d+) passed(?:, [^\n]*)? in [^\n]+$",
        "playwright": r"^\s*(\d+) passed \([^\n]+\)$",
        "unittest": r"^Ran (\d+) tests? in [^\n]+$",
    }
    counts = {kind: [int(n) for n in re.findall(pattern, text, re.M)]
              for kind, pattern in patterns.items()}
    failures = bool(re.search(
        r"^ℹ fail [1-9]|^\s*[1-9]\d* failed|^FAILED(?: |$)|^ERROR(?: |$)",
        text, re.M))
    skipped = [int(n) for n in re.findall(r"^ℹ skipped (\d+)$", text, re.M)]
    identities = re.findall(r"^\s*✓\s+\d+\s+(.+?)\s+\([\d.]+(?:ms|s|m|h)\)\s*$", text, re.M)
    return {"groups": counts, "totals": {k: sum(v) for k, v in counts.items()},
            "failure": failures, "node_skipped": skipped,
            "browser_cases": sorted(identities),
            "bootstrap_checks": len(re.findall(
                r"^✔ preview never invokes the production initialization wrapper", text, re.M)),
            "other_skips": re.findall(r"\b[1-9]\d* (?:skipped|xfailed|xpassed)\b", text)}


def partitioned_equal(before, after, added_operator_tests):
    """Only allow regrouping and the explicitly counted new setup assertions."""
    if before["failure"] or after["failure"] or before["other_skips"] != after["other_skips"]:
        return False
    if any(before["node_skipped"]) or any(after["node_skipped"]):
        return False
    for report in (before, after):
        if report["groups"]["node"].count(4) != report["bootstrap_checks"]:
            return False
        if not report["browser_cases"] or len(report["browser_cases"]) != report["totals"]["playwright"]:
            return False
    expected_unit = list(before["groups"]["unittest"])
    if not expected_unit or added_operator_tests < 0:
        return False
    expected_unit[-1] += added_operator_tests
    return (
        sorted(n for n in before["groups"]["node"] if n != 4)
        == sorted(n for n in after["groups"]["node"] if n != 4)
        and after["bootstrap_checks"] >= before["bootstrap_checks"]
        and before["groups"]["pytest"] == after["groups"]["pytest"]
        and before["browser_cases"] == after["browser_cases"]
        and before["totals"]["playwright"] == after["totals"]["playwright"]
        and expected_unit == after["groups"]["unittest"]
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--partitioned", action="store_true")
    parser.add_argument("--added-operator-tests", type=int, default=0)
    args = parser.parse_args()
    before, after = inventory(args.before), inventory(args.after)
    equal = (before == after and not before["failure"]
             and all(before["groups"][key] for key in ("node", "pytest", "playwright", "unittest")))
    if args.partitioned:
        equal = partitioned_equal(before, after, args.added_operator_tests)
    print(json.dumps({"equal_original_coverage": equal, "before": before, "after": after}, indent=2))
    return 0 if equal else 1


if __name__ == "__main__":
    raise SystemExit(main())
