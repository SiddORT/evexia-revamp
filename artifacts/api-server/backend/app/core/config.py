from functools import lru_cache

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
    cors_origins: str = ""
    allow_public_registration: bool = False
    s3_bucket: str | None = None
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    aws_access_key_id: SecretStr | None = None
    aws_secret_access_key: SecretStr | None = None
    max_upload_bytes: int = 20 * 1024 * 1024

    @field_validator("app_env")
    @classmethod
    def valid_environment(cls, value: str) -> str:
        if value not in ("development", "test", "production"):
            raise ValueError("APP_ENV must be development, test, or production")
        return value

    @field_validator("access_token_minutes", "refresh_token_days", "max_upload_bytes")
    @classmethod
    def positive(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("Security limits must be positive")
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