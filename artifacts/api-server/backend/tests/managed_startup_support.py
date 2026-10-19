"""Private managed-launcher test plumbing; never prints raw child output."""
from collections import deque
from contextlib import contextmanager
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import sys
import threading


def dependency_environment(env, bin_dir, search_path=None):
    """Retain installed packages, not the original checkout's application paths.

    CI runs a base interpreter with uv's .pythonlibs site-packages on sys.path.
    Reusing sys.executable alone would therefore still lose the dependencies.
    """
    packages = list(dict.fromkeys(
        str(Path(entry).absolute()) for entry in
        (sys.path if search_path is None else search_path)
        if entry and Path(entry).name in {"site-packages", "dist-packages"}
        and Path(entry).is_dir()
    ))
    if not packages:
        raise AssertionError("Managed fixture requires installed Python package directories")
    bin_dir.mkdir(mode=0o700)
    # Do not resolve a venv executable's symlink: its adjacent pyvenv.cfg matters.
    interpreter = bin_dir / "python"
    interpreter.write_text(f'#!/bin/sh\nexec {shlex.quote(sys.executable)} "$@"\n')
    interpreter.chmod(0o700)
    return {**env, "PATH": str(bin_dir) + os.pathsep + env.get("PATH", ""),
            "PYTHONPATH": os.pathsep.join(packages)}


_EXCEPTIONS = (
    "ModuleNotFoundError", "ImportError", "ValidationError", "ValueError",
    "RuntimeError", "OperationalError", "ProgrammingError", "PermissionError",
    "FileNotFoundError", "TimeoutError", "KeyError", "TypeError",
)
_MODULES = ("sqlalchemy", "alembic", "pydantic", "pydantic_settings", "uvicorn",
            "fastapi", "psycopg", "app")
_BLOCKS = (
    "DEVELOPMENT_ONLY", "WRONG_DEVELOPMENT_DATABASE", "OTHER_OPERATOR_ACTIVE",
    "FRESH_DATABASE_REQUIRES_SUPPORTED_FRESH_INSTALL", "MIGRATION_CHANGED",
    "POSTCONDITION_FAILED", "INVALID_DEVELOPMENT_DECLARATION",
    "MULTIPLE_OR_MISSING_SOURCE_HEADS", "DEVELOPMENT_EXECUTION_REVIEW_REQUIRED",
    "GENERATED_APPLICATION_SCHEMA_DRIFT", "DEVELOPMENT_MIGRATION_REVIEW_REQUIRED",
)


def sanitized_startup_output(raw, root):
    """Project only known status/code/frame information, never arbitrary values.

    Replacement-based scrubbing cannot safely cover quoted URLs, multiline
    keyrings, exception inputs or unknown provider credentials. Unknown text,
    source-code lines and exception messages are deliberately withheld.
    """
    safe = []
    for line in raw.decode("utf-8", errors="replace").splitlines():
        if line == "DEVELOPMENT_SCHEMA_CONSISTENT: source only; no activation authorization":
            safe.append(line)
        elif line.startswith('{"result": "READY", "schema":'):
            safe.append("DEVELOPMENT_SYNC: READY")
        elif line.startswith(("DEVELOPMENT_SCHEMA_BLOCKED: ", "DEVELOPMENT_SYNC_BLOCKED: ")):
            stage, _, code = line.partition(": ")
            safe.append(f"{stage}: {code if code in (*_EXCEPTIONS, *_BLOCKS) else '[detail withheld]'}")
        elif line.startswith("ModuleNotFoundError: No module named "):
            module = line.removeprefix("ModuleNotFoundError: No module named ")
            safe.append("ModuleNotFoundError: " + (
                module if module in tuple(repr(name) for name in _MODULES)
                else "[module withheld]"))
        elif any(line.endswith(": No module named " + name) for name in _MODULES):
            safe.append("Python: No module named " + line.rsplit(" ", 1)[1])
        elif any(line.startswith(name + ":") or line == name for name in _EXCEPTIONS):
            safe.append(line.split(":", 1)[0] + ": [detail withheld]")
        elif line.startswith("INFO:") and "Uvicorn running on " in line:
            safe.append("UVICORN: listener started")
        elif line.startswith("ERROR:") and "Application startup failed." in line:
            safe.append("UVICORN: application startup failed")
        else:
            frame = re.fullmatch(r'  File "([^"]+)", line ([0-9]+)(?:, in .*)?', line)
            if frame:
                try:
                    relative = Path(frame[1]).relative_to(root).as_posix()
                except ValueError:
                    continue
                # Only file names copied from reviewed source are reportable.
                if relative in {"scripts/review-development-schema.py",
                                "scripts/development-sync.py", "scripts/deploy-migrations.py",
                                "artifacts/api-server/backend/app/main.py",
                                "artifacts/api-server/backend/app/core/config.py"}:
                    safe.append(f"  {relative}:{frame[2]}")
    return "\n".join(safe[-40:]) or "[no allowlisted startup details; raw output withheld]"


class StartupOutput:
    def __init__(self, stream, root):
        self.root = root
        self.stream = stream
        self.chunks = deque(maxlen=4)  # At most 16 KiB, regardless of output volume.
        self.lock = threading.Lock()
        self.listener_started = threading.Event()
        self.read_failed = threading.Event()
        self.reader = threading.Thread(target=self._drain, daemon=True)
        self.reader.start()

    def _drain(self):
        previous = b""
        try:
            while chunk := self.stream.read1(4096):
                if b"Uvicorn running" in previous + chunk:
                    self.listener_started.set()
                previous = chunk[-64:]
                with self.lock:
                    self.chunks.append(chunk)
        except OSError:
            self.read_failed.set()

    def diagnostic(self, process, reason):
        status = process.poll()
        if status is not None:
            self.reader.join(timeout=.5)
        with self.lock:
            output = sanitized_startup_output(b"".join(self.chunks), self.root)
        return (f"{reason}; exit_status={status if status is not None else 'running'}; "
                f"output_read_failed={self.read_failed.is_set()}\n{output}")


@contextmanager
def managed_launcher(root, env):
    """Own one new process group, including review/sync/diagnostic descendants."""
    process = subprocess.Popen(
        ["sh", str(root / "scripts/start-development-api.sh")],
        cwd=root / "artifacts/api-server", env=env, start_new_session=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    output = None
    primary = None
    try:
        output = StartupOutput(process.stdout, root)
        yield process, output
    except BaseException as error:
        primary = error
        raise
    finally:
        try:
            # The shell may already have exited while a child still owns stdout.
            # Never signal a shared listener or a process outside this new group.
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(process.pid, sig)
                except ProcessLookupError:
                    pass
                if sig == signal.SIGTERM:
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        pass
            process.wait(timeout=5)
            if output is not None:
                output.reader.join(timeout=1)
                if output.reader.is_alive():
                    raise RuntimeError("Managed fixture output reader did not stop")
                if output.read_failed.is_set():
                    raise RuntimeError("Managed fixture output reader failed")
            process.stdout.close()
        except Exception as error:
            message = "Managed fixture cleanup failed: " + type(error).__name__
            if primary is not None:
                primary.add_note(message)
            else:
                raise AssertionError(message) from None
