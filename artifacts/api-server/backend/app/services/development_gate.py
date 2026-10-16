"""Single-flight, finite-cache development gate; no production enforcement."""
import asyncio
import json
import os
import subprocess
import sys
import time

from app.core.development_identity import LOADED_IDENTITY, candidate_identity


def enabled(settings):
    return settings.app_env == "development" and os.environ.get("EVEXIA_MANAGED_PREVIEW") == "1"


def run_preflight():
    try:
        child = subprocess.run([sys.executable, "-m", "app.services.development_preflight"],
                               capture_output=True, timeout=10, check=False)
        result = json.loads(child.stdout)
        return child.returncode == 0 and result.get("format") == 1 and result.get("ok") is True
    except Exception:
        return False


class DevelopmentGate:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.until = 0
        self.ok = False

    async def ready(self):
        async with self.lock:
            if time.monotonic() < self.until:
                return self.ok
            try:
                current = await asyncio.to_thread(candidate_identity)
                from app.core.schema import SCHEMA_REVISION
                matching = current == LOADED_IDENTITY and current["schema"] == SCHEMA_REVISION
                self.ok = matching and await asyncio.to_thread(run_preflight)
            except Exception:
                self.ok = False
            self.until = time.monotonic() + 5
            return self.ok
