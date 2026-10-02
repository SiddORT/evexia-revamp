from functools import lru_cache
import re

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    app_env: str = "development"
    database_url: str
    jwt_secret: SecretStr | None = None
    session_secret: SecretStr | None = None
    jwt_issuer: str = "evexia"
    jwt_audience: str = "evexia-api"
    access_token_minutes: int = 15
    refresh_token_days: int = 7
    session_refresh_hours: int = 12
    super_admin_initial_password: SecretStr | None = None
    cors_origins: str = ""
    allow_public_registration: bool = False
    s3_bucket: str | None = None
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    aws_access_key_id: SecretStr | None = None
    aws_secret_access_key: SecretStr | None = None
    max_upload_bytes: int = 20 * 1024 * 1024
    storage_backend: str = "local"
    # Optional so normal application startup does not require storage to be configured.
    # get_storage() fails explicitly if local storage is selected without this value.
    local_storage_root: str | None = None
    download_grant_seconds: int = 300
    # Maximum file operations per rolling 15-minute window, applied by the API layer.
    file_rate_limit: int = 30
    file_concurrency_limit: int = 4
    scanner_backend: str = "unavailable"
    clamd_host: str = "127.0.0.1"
    clamd_port: int = 3310
    scanner_timeout_seconds: int = 10
    file_request_timeout_seconds: int = 30

    @field_validator("app_env")
    @classmethod
    def valid_environment(cls, value: str) -> str:
        if value not in ("development", "test", "production"):
            raise ValueError("APP_ENV must be development, test, or production")
        return value

    @field_validator("storage_backend")
    @classmethod
    def valid_storage_backend(cls, value: str) -> str:
        if value not in ("local", "s3"):
            raise ValueError("STORAGE_BACKEND must be local or s3")
        return value

    @field_validator("scanner_backend")
    @classmethod
    def valid_scanner_backend(cls, value: str) -> str:
        if value not in ("clamd", "unavailable"):
            raise ValueError("SCANNER_BACKEND must be clamd or unavailable")
        return value

    @field_validator("local_storage_root")
    @classmethod
    def valid_local_storage_root(cls, value: str | None) -> str | None:
        if value is not None and (not value or not value.startswith("/") or "\x00" in value):
            raise ValueError("LOCAL_STORAGE_ROOT must be an explicit absolute path")
        return value

    @field_validator("clamd_host")
    @classmethod
    def valid_clamd_host(cls, value: str) -> str:
        if not value or not re.fullmatch(r"[A-Za-z0-9.-]+", value):
            raise ValueError("CLAMD_HOST must be a trusted hostname or IP address")
        return value

    @field_validator("access_token_minutes", "refresh_token_days", "max_upload_bytes")
    @classmethod
    def positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Security limits must be positive")
        return value

    @field_validator("access_token_minutes")
    @classmethod
    def bounded_access_minutes(cls, value: int) -> int:
        if not 1 <= value <= 60:
            raise ValueError("ACCESS_TOKEN_MINUTES must be between 1 and 60 minutes")
        return value

    @field_validator("refresh_token_days")
    @classmethod
    def bounded_refresh_days(cls, value: int) -> int:
        if not 1 <= value <= 30:
            raise ValueError("REFRESH_TOKEN_DAYS must be between 1 and 30 days")
        return value

    @field_validator("session_refresh_hours")
    @classmethod
    def bounded_session_hours(cls, value: int) -> int:
        if not 1 <= value <= 24:
            raise ValueError("SESSION_REFRESH_HOURS must be between 1 and 24 hours")
        return value

    @field_validator("max_upload_bytes")
    @classmethod
    def bounded_upload_size(cls, value: int) -> int:
        if not 1 <= value <= 100 * 1024 * 1024:
            raise ValueError("MAX_UPLOAD_BYTES must be between 1 byte and 100 MiB")
        return value

    @field_validator("download_grant_seconds")
    @classmethod
    def bounded_download_grant(cls, value: int) -> int:
        if not 1 <= value <= 900:
            raise ValueError("DOWNLOAD_GRANT_SECONDS must be between 1 and 900 seconds")
        return value

    @field_validator("file_rate_limit")
    @classmethod
    def bounded_file_rate_limit(cls, value: int) -> int:
        if not 1 <= value <= 1000:
            raise ValueError("FILE_RATE_LIMIT must be between 1 and 1000 operations per 15 minutes")
        return value

    @field_validator("file_concurrency_limit")
    @classmethod
    def bounded_file_concurrency(cls, value: int) -> int:
        if not 1 <= value <= 64:
            raise ValueError("FILE_CONCURRENCY_LIMIT must be between 1 and 64")
        return value

    @field_validator("clamd_port")
    @classmethod
    def valid_clamd_port(cls, value: int) -> int:
        if not 1 <= value <= 65535:
            raise ValueError("CLAMD_PORT must be between 1 and 65535")
        return value

    @field_validator("scanner_timeout_seconds")
    @classmethod
    def bounded_scanner_timeout(cls, value: int) -> int:
        if not 1 <= value <= 30:
            raise ValueError("SCANNER_TIMEOUT_SECONDS must be between 1 and 30 seconds")
        return value

    @field_validator("file_request_timeout_seconds")
    @classmethod
    def bounded_request_timeout(cls, value: int) -> int:
        if not 1 <= value <= 120:
            raise ValueError("FILE_REQUEST_TIMEOUT_SECONDS must be between 1 and 120 seconds")
        return value

    @property
    def signing_key(self) -> str:
        secret = self.jwt_secret or self.session_secret
        if secret is None or len(secret.get_secret_value()) < 32:
            raise ValueError("JWT_SECRET or SESSION_SECRET must contain at least 32 characters")
        return secret.get_secret_value()

    @property
    def allowed_origins(self) -> list[str]:
        origins = [part.strip().rstrip("/") for part in self.cors_origins.split(",") if part.strip()]
        if any(not origin.startswith(("https://", "http://")) or "*" in origin for origin in origins):
            raise ValueError("CORS_ORIGINS must contain explicit http(s) origins, never wildcards")
        if self.app_env == "production" and any(origin.startswith("http://") for origin in origins):
            raise ValueError("Production CORS origins must use HTTPS")
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()