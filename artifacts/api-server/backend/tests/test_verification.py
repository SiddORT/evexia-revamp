import hashlib
import io
import struct
import zlib

import pytest
from PIL import Image
from pypdf import PdfWriter

from app.core.config import Settings
from app.services.verification import ClamdScanner, validated_extension, verify


def make_settings(**overrides):
    values = {"database_url": "sqlite:///unused", "max_upload_bytes": 4096, **overrides}
    return Settings(**values)


def png_bytes(width=1, height=1):
    def chunk(kind, payload):
        return (
            struct.pack("!I", len(payload))
            + kind
            + payload
            + struct.pack("!I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    header = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)
    pixels = b"".join(b"\x00\x00\x00\x00\xff" for _ in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(pixels))
        + chunk(b"IEND", b"")
    )


def jpeg_bytes(width=1, height=1):
    image = Image.new("RGB", (width, height), color=(30, 60, 90))
    content = io.BytesIO()
    image.save(content, format="JPEG")
    return content.getvalue()


def pdf_bytes(page_count=1):
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=100, height=100)
    content = io.BytesIO()
    writer.write(content)
    return content.getvalue()


class InjectedScanner:
    def __init__(self, result="clean"):
        self.result = result
        self.received = None

    def scan(self, content, settings):
        self.received = content
        return self.result


@pytest.mark.parametrize(
    ("filename", "content_type", "content", "extension"),
    [
        ("profile.png", "image/png", png_bytes(), "png"),
        ("profile.jpeg", "image/jpeg", jpeg_bytes(), "jpeg"),
        ("report.pdf", "application/pdf", pdf_bytes(), "pdf"),
    ],
)
def test_verify_checks_format_and_returns_real_byte_metadata(
    filename, content_type, content, extension
):
    result = verify(io.BytesIO(content), filename, content_type, make_settings())
    assert result.extension == extension
    assert result.content_type == content_type
    assert result.size == len(content)
    assert result.checksum == hashlib.sha256(content).hexdigest()
    assert result.scanner_status == "unavailable"


def test_verify_only_reports_clean_from_a_configured_or_injected_scanner():
    content = png_bytes()
    scanner = InjectedScanner()
    result = verify(
        io.BytesIO(content),
        "profile.png",
        "image/png",
        make_settings(scanner_backend="unavailable"),
        scanner=scanner,
    )
    assert scanner.received == content
    assert result.scanner_status == "clean"
    assert verify(
        io.BytesIO(content),
        "profile.png",
        "image/png",
        make_settings(scanner_backend="unavailable"),
    ).scanner_status == "unavailable"


def test_verified_extension_is_available_before_body_streaming_and_verify_is_retryable():
    assert validated_extension("Report.PDF") == "pdf"
    assert validated_extension("portrait.JPEG") == "jpeg"
    content = png_bytes()
    staged = io.BytesIO(content)
    result = verify(staged, "profile.png", "image/png", make_settings())
    assert result.extension == validated_extension("profile.png")
    assert staged.tell() == 0
    retried = verify(staged, "profile.png", "image/png", make_settings())
    assert retried.checksum == result.checksum
    assert staged.tell() == 0


@pytest.mark.parametrize("status", ["infected", "error", "unavailable"])
def test_verify_preserves_nonclean_scanner_states(status):
    result = verify(
        io.BytesIO(png_bytes()),
        "profile.png",
        "image/png",
        make_settings(),
        scanner=InjectedScanner(status),
    )
    assert result.scanner_status == status


class RaisingScanner:
    def scan(self, content, settings):
        raise TimeoutError("scanner timed out")


def test_verify_converts_scanner_exception_to_fail_closed_error():
    result = verify(
        io.BytesIO(png_bytes()),
        "profile.png",
        "image/png",
        make_settings(),
        scanner=RaisingScanner(),
    )
    assert result.scanner_status == "error"


@pytest.mark.parametrize(
    ("filename", "content_type", "content"),
    [
        ("../profile.png", "image/png", png_bytes()),
        ("profile%2epng", "image/png", png_bytes()),
        ("profile.jpg", "image/png", png_bytes()),
        ("profile.pdf", "application/pdf", b"\x89PNG\r\n\x1a\n"),
        ("profile.png", "image/png", b"\x89PNG\r\n\x1a\nnot a png"),
    ],
)
def test_verify_rejects_unsafe_filename_and_mime_signature_mismatches(
    filename, content_type, content
):
    with pytest.raises(ValueError):
        verify(io.BytesIO(content), filename, content_type, make_settings())


def test_real_image_and_pdf_parsers_reject_malformed_structures():
    image = jpeg_bytes()
    scan_start = image.index(b"\xff\xda")
    scan_length = int.from_bytes(image[scan_start + 2 : scan_start + 4], "big")
    scan_end = scan_start + 2 + scan_length
    missing_entropy = image[:scan_end] + b"\xff\xd9"
    with pytest.raises(ValueError, match="malformed"):
        verify(
            io.BytesIO(missing_entropy),
            "truncated.jpg",
            "image/jpeg",
            make_settings(),
        )

    fake_pdf = b"%PDF-1.4\n1 0 obj << /Type /Page >> endobj\n%%EOF\n"
    with pytest.raises(ValueError, match="malformed"):
        verify(io.BytesIO(fake_pdf), "fake.pdf", "application/pdf", make_settings())


def test_verify_bounds_actual_bytes_and_parser_expansion():
    settings = make_settings(max_upload_bytes=32)
    with pytest.raises(ValueError, match="size limit"):
        verify(io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"x" * 64), "a.png", "image/png", settings)

    oversized_dimensions = png_bytes(width=5000, height=5000)
    with pytest.raises(ValueError, match="dimensions"):
        verify(
            io.BytesIO(oversized_dimensions),
            "large.png",
            "image/png",
            make_settings(),
        )


def test_verify_rejects_malformed_or_active_pdf_and_excessive_pages():
    with pytest.raises(ValueError, match="malformed"):
        verify(io.BytesIO(b"%PDF-1.4\nnot finished"), "bad.pdf", "application/pdf", make_settings())
    active_pdf = pdf_bytes()
    active = active_pdf.replace(b"\n", b"\n% /JavaScript\n", 1)
    with pytest.raises(ValueError, match="active"):
        verify(io.BytesIO(active), "active.pdf", "application/pdf", make_settings())

    excessive = pdf_bytes(2001)
    with pytest.raises(ValueError, match="page-count"):
        verify(
            io.BytesIO(excessive),
            "many-pages.pdf",
            "application/pdf",
            make_settings(max_upload_bytes=4 * 1024 * 1024),
        )


def test_clamd_recognizes_typical_found_response(monkeypatch):
    class FakeClamdSocket:
        def __init__(self):
            self.timeouts = []
            self.sent = bytearray()

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def settimeout(self, timeout):
            self.timeouts.append(timeout)

        def sendall(self, data):
            self.sent.extend(data)

        def recv(self, size):
            return b"stream: Eicar-Test-Signature FOUND\x00"

    fake_socket = FakeClamdSocket()
    monkeypatch.setattr("app.services.verification.socket.create_connection", lambda *a, **k: fake_socket)
    settings = make_settings(scanner_backend="clamd", scanner_timeout_seconds=3)
    assert ClamdScanner().scan(b"EICAR", settings) == "infected"
    assert bytes(fake_socket.sent).startswith(b"zINSTREAM\0")
    assert max(fake_socket.timeouts) <= 3


def test_settings_bound_storage_and_scanner_limits():
    with pytest.raises(ValueError):
        make_settings(download_grant_seconds=901)
    with pytest.raises(ValueError):
        make_settings(file_rate_limit=0)
    with pytest.raises(ValueError):
        make_settings(file_concurrency_limit=65)
    with pytest.raises(ValueError):
        make_settings(scanner_backend="test-clean")