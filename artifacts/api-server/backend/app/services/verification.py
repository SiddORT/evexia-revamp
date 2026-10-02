"""Bounded file-format verification and fail-closed malware scanning integration."""

from __future__ import annotations

import hashlib
import os
import re
import socket
import struct
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import BinaryIO, Literal, Protocol

from app.core.config import Settings

ScannerStatus = Literal["clean", "infected", "unavailable", "error"]
_MIME_EXTENSION = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
}
_CHUNK_SIZE = 1024 * 1024
_MAX_IMAGE_PIXELS = 20_000_000
_MAX_PDF_PAGES = 2_000
_MAX_PDF_OBJECTS = 100_000
_MAX_PDF_DECODED_BYTES = 100 * 1024 * 1024
_PARSER_TIMEOUT_SECONDS = 8
_PARSER_MEMORY_LIMIT_BYTES = 512 * 1024 * 1024
_PARSER_CPU_LIMIT_SECONDS = 6


@dataclass(frozen=True)
class VerifiedUpload:
    extension: str
    content_type: str
    size: int
    checksum: str
    scanner_status: ScannerStatus


class MalwareScanner(Protocol):
    def scan(self, content: bytes, settings: Settings) -> ScannerStatus: ...


class ClamdScanner:
    """Use a configured, trusted clamd TCP endpoint with a total operation deadline."""

    def scan(self, content: bytes, settings: Settings) -> ScannerStatus:
        timeout = settings.scanner_timeout_seconds
        deadline = time.monotonic() + timeout
        try:
            with socket.create_connection(
                (settings.clamd_host, settings.clamd_port),
                timeout=timeout,
            ) as client:
                def send_with_deadline(payload: bytes) -> None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError("clamd scan deadline exceeded")
                    client.settimeout(remaining)
                    client.sendall(payload)

                send_with_deadline(b"zINSTREAM\0")
                for offset in range(0, len(content), _CHUNK_SIZE):
                    chunk = content[offset : offset + _CHUNK_SIZE]
                    send_with_deadline(struct.pack("!I", len(chunk)))
                    send_with_deadline(chunk)
                send_with_deadline(struct.pack("!I", 0))

                response = bytearray()
                while len(response) < 4096:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise TimeoutError("clamd scan deadline exceeded")
                    client.settimeout(remaining)
                    part = client.recv(min(1024, 4096 - len(response)))
                    if not part:
                        break
                    response.extend(part)
                    if b"\0" in part or b"\n" in part:
                        break

            result = response.decode("utf-8", errors="replace").strip("\0\r\n ")
            status = result.rsplit(" ", 1)[-1]
            if status == "OK":
                return "clean"
            if status == "FOUND":
                return "infected"
            return "error"
        except (OSError, TimeoutError, ValueError):
            return "error"


def validated_extension(filename: str) -> str:
    """Return a normalized allowed extension from a safe basename, not file proof."""
    if (
        not isinstance(filename, str)
        or not filename
        or len(filename) > 255
        or "/" in filename
        or "\\" in filename
        or "%" in filename
        or any(ord(char) < 32 or ord(char) == 127 for char in filename)
    ):
        raise ValueError("Filename must be a plain basename without path/control characters")
    suffix = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix not in ("jpg", "jpeg", "png", "pdf"):
        raise ValueError("File extension is not allowed")
    return suffix


_PARSER_WORKER = r"""
import io
import resource
import sys
import warnings

class Rejected(Exception):
    def __init__(self, code):
        self.code = code

resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (6, 6))
resource.setrlimit(resource.RLIMIT_FSIZE, (1024 * 1024, 1024 * 1024))
sys.path[:0] = sys.argv[2:]

try:
    mode = sys.argv[1]
    payload = sys.stdin.buffer.read(100 * 1024 * 1024 + 1)
    if len(payload) > 100 * 1024 * 1024:
        raise Rejected("size")

    if mode in ("jpg", "jpeg", "png"):
        from PIL import Image, ImageFile

        Image.MAX_IMAGE_PIXELS = 20_000_000
        ImageFile.LOAD_TRUNCATED_IMAGES = False
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        expected_format = "PNG" if mode == "png" else "JPEG"
        if mode in ("jpg", "jpeg"):
            if not payload.startswith(b"\xff\xd8") or not payload.endswith(b"\xff\xd9"):
                raise Rejected("invalid_image")
            marker_pos = 2
            scan_start = None
            while marker_pos < len(payload) - 2:
                if payload[marker_pos] != 0xFF:
                    raise Rejected("invalid_image")
                while marker_pos < len(payload) and payload[marker_pos] == 0xFF:
                    marker_pos += 1
                marker = payload[marker_pos]
                marker_pos += 1
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                    continue
                if marker_pos + 2 > len(payload):
                    raise Rejected("invalid_image")
                segment_length = int.from_bytes(payload[marker_pos:marker_pos + 2], "big")
                if segment_length < 2 or marker_pos + segment_length > len(payload):
                    raise Rejected("invalid_image")
                if marker == 0xDA:
                    scan_start = marker_pos + segment_length
                    break
                marker_pos += segment_length
            if scan_start is None or payload.rfind(b"\xff\xd9") <= scan_start:
                raise Rejected("invalid_image")
        try:
            with Image.open(io.BytesIO(payload), formats=(expected_format,)) as image:
                if image.format != expected_format:
                    raise Rejected("signature")
                if image.width < 1 or image.height < 1 or image.width * image.height > 20_000_000:
                    raise Rejected("image_dimensions")
                image.verify()
            with Image.open(io.BytesIO(payload), formats=(expected_format,)) as image:
                image.load()
                if image.width * image.height > 20_000_000:
                    raise Rejected("image_dimensions")
        except Rejected:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise Rejected("image_dimensions")
        except Exception:
            raise Rejected("invalid_image")

    elif mode == "pdf":
        from pypdf import PdfReader

        try:
            reader = PdfReader(
                io.BytesIO(payload),
                strict=True,
                root_object_recovery_limit=10_000,
            )
            if reader.is_encrypted:
                raise Rejected("encrypted_pdf")
            xref_tables = reader.xref.values()
            object_count = sum(len(table) for table in xref_tables if isinstance(table, dict))
            if object_count > 100_000:
                raise Rejected("pdf_object_limit")
            pages = reader.pages
            page_count = len(pages)
            if page_count < 1:
                raise Rejected("pdf_no_pages")
            if page_count > 2_000:
                raise Rejected("pdf_page_limit")
            decoded_bytes = 0
            for page in pages:
                content = page.get_contents()
                if content is not None:
                    decoded_bytes += len(content.get_data())
                    if decoded_bytes > 100 * 1024 * 1024:
                        raise Rejected("pdf_decompression_limit")
        except Rejected:
            raise
        except Exception:
            raise Rejected("invalid_pdf")
    else:
        raise Rejected("unsupported")

    print("OK")
except Rejected as exc:
    print(exc.code)
except BaseException:
    print("invalid")
"""


def _parse_in_isolated_worker(data: bytes, extension: str) -> None:
    """Run maintained image/PDF parsers with bounded resources and stdin-only input."""
    parser_package_paths = [
        path
        for path in sys.path
        if path
        and os.path.isabs(path)
        and os.path.isfile(os.path.join(path, "PIL", "__init__.py"))
        and os.path.isfile(os.path.join(path, "pypdf", "__init__.py"))
    ]
    if not parser_package_paths:
        raise ValueError("Required bounded image/PDF parsers are unavailable")
    try:
        completed = subprocess.run(
            [
                sys.executable,
                "-I",
                "-c",
                _PARSER_WORKER,
                extension,
                *parser_package_paths,
            ],
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=_PARSER_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ValueError("File parser exceeded its time limit") from exc
    except OSError as exc:
        raise ValueError("File parser is unavailable") from exc

    result = completed.stdout.decode("ascii", errors="ignore").strip()
    if completed.returncode != 0 or result != "OK":
        error_messages = {
            "image_dimensions": "Image dimensions exceed the parser limit",
            "pdf_page_limit": "PDF exceeds the page-count limit",
            "pdf_object_limit": "PDF exceeds the object-count limit",
            "pdf_decompression_limit": "PDF exceeds the decompression limit",
            "size": "File exceeds the parser size limit",
        }
        message = error_messages.get(result, "File is malformed or unsupported")
        raise ValueError(f"{message} (parser_status={result or 'empty'}, exit={completed.returncode})")


def _validate_format(data: bytes, extension: str, content_type: str) -> None:
    if content_type == "application/pdf":
        # Conservative active-content policy. Structural validity is independently
        # established by pypdf inside the isolated parser worker.
        if re.search(rb"/(?:Encrypt|JavaScript|JS|EmbeddedFile|Launch|OpenAction|AA)\b", data):
            raise ValueError("PDF contains unsupported active or embedded content")
    _parse_in_isolated_worker(data, extension)


def _read_bounded(stream: BinaryIO, max_bytes: int) -> tuple[bytes, str]:
    digest = hashlib.sha256()
    content = bytearray()
    while True:
        chunk = stream.read(min(_CHUNK_SIZE, max_bytes + 1 - len(content)))
        if not chunk:
            break
        if not isinstance(chunk, bytes):
            raise TypeError("Upload must be provided as a binary stream")
        content.extend(chunk)
        if len(content) > max_bytes:
            raise ValueError("Upload exceeds the configured size limit")
        digest.update(chunk)
    if not content:
        raise ValueError("Empty files are not accepted")
    return bytes(content), digest.hexdigest()


def verify(
    stream: BinaryIO,
    filename: str,
    content_type: str,
    settings: Settings,
    *,
    scanner: MalwareScanner | None = None,
) -> VerifiedUpload:
    """Verify actual bytes while preserving a seekable stream's starting position.

    Scanner outcomes are returned (never raised); format/size failures raise a
    generic ValueError. The scanner injection exists for unit tests only.
    """
    extension = validated_extension(filename)
    expected_type = _MIME_EXTENSION.get(content_type)
    if expected_type is None or extension not in (
        (expected_type, "jpeg") if expected_type == "jpg" else (expected_type,)
    ):
        raise ValueError("Filename extension and declared content type do not match")
    try:
        starting_position = stream.tell()
    except (AttributeError, OSError):
        starting_position = None
    try:
        data, checksum = _read_bounded(stream, settings.max_upload_bytes)
        _validate_format(data, extension, content_type)

        active_scanner = scanner
        if active_scanner is None and settings.scanner_backend == "clamd":
            active_scanner = ClamdScanner()
        if active_scanner is None:
            scanner_status: ScannerStatus = "unavailable"
        else:
            try:
                scanner_status = active_scanner.scan(data, settings)
                if scanner_status not in ("clean", "infected", "unavailable", "error"):
                    scanner_status = "error"
            except Exception:
                scanner_status = "error"
        return VerifiedUpload(extension, content_type, len(data), checksum, scanner_status)
    finally:
        if starting_position is not None:
            try:
                stream.seek(starting_position)
            except (AttributeError, OSError):
                pass