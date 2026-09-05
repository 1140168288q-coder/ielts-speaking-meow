"""服务端配置：全部来自环境变量，绝不硬编码密钥。"""
from functools import lru_cache
from typing import Literal
from urllib.parse import urlsplit

from pydantic import EmailStr, Field, SecretStr, TypeAdapter, field_validator
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ---- 账号与数据库 ----
    database_url: str = "sqlite+aiosqlite:///./data/ielts_cat.db"
    auth_session_ttl_seconds: int = Field(default=30 * 24 * 60 * 60, ge=60)
    email_verification_token_ttl_seconds: int = Field(
        default=24 * 60 * 60, ge=300
    )
    password_reset_token_ttl_seconds: int = Field(default=60 * 60, ge=300)

    # ---- free plan 默认额度；0 表示该周期没有可用额度 ----
    free_feedback_monthly_quota: int = Field(default=60, ge=0)
    free_organize_monthly_quota: int = Field(default=10, ge=0)
    free_material_suggest_monthly_quota: int = Field(default=20, ge=0)
    free_tts_characters_monthly_quota: int = Field(default=100_000, ge=0)
    free_provider_verify_daily_quota: int = Field(default=10, ge=0)

    # ---- 同步协议安全边界（按 UTF-8 JSON 字节数）----
    sync_max_item_bytes: int = Field(default=64 * 1024, ge=1024)
    sync_max_batch_bytes: int = Field(default=512 * 1024, ge=1024)
    sync_max_request_bytes: int = Field(default=640 * 1024, ge=1024)

    # ---- 账号邮件 ----
    # APP_ACCOUNT_URL 是邮件链接的唯一来源，绝不使用请求 Host header 拼接。
    app_account_url: str = ""
    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_user: str = ""
    smtp_password: SecretStr = SecretStr("")
    smtp_from: str = ""
    smtp_tls_mode: Literal["starttls", "ssl"] = "starttls"
    smtp_timeout_seconds: float = Field(default=15.0, gt=0, le=120)

    # ---- DeepSeek(Text AI)----
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_base_url: str = "https://api.deepseek.com"
    # DeepSeek 请求预算：服务端总预算小于客户端 105 秒；最多两次尝试。
    deepseek_connect_timeout_seconds: float = Field(default=10.0, gt=0, le=30)
    deepseek_read_timeout_seconds: float = Field(default=75.0, gt=0, le=90)
    deepseek_write_timeout_seconds: float = Field(default=10.0, gt=0, le=30)
    deepseek_pool_timeout_seconds: float = Field(default=10.0, gt=0, le=30)
    deepseek_total_timeout_seconds: float = Field(default=90.0, gt=0, le=120)
    deepseek_max_attempts: int = Field(default=2, ge=1, le=2)
    deepseek_retry_backoff_seconds: float = Field(default=0.25, ge=0, le=5)

    # ---- 火山引擎:新版控制台鉴权(单头 X-Api-Key)----
    volc_api_key: str = ""
    # ---- 火山引擎:旧版控制台鉴权(APP ID + Access Token)----
    volc_app_id: str = ""
    volc_access_token: str = ""
    # ---- 火山引擎语音合成 ----
    volc_endpoint: str = "https://openspeech.bytedance.com"
    volc_tts_resource_id: str = "seed-tts-2.0"  # 语音合成大模型 2.0
    # 默认使用与 seed-tts-2.0 资源匹配的英语 uranus 音色,适合 IELTS 播报。
    # 旧版 mars 音色(如 en_female_anna_mars_bigtts)必须配 seed-tts-1.0。
    volc_tts_speaker: str = "en_female_dacey_uranus_bigtts"
    # 音色展示名(可选,只出现在 /health 与设置页,便于人眼确认音色)。
    volc_tts_speaker_name: str = ""

    # ---- 基础限流(默认关闭,预留接口)----
    rate_limit_enabled: bool = False
    rate_limit_per_minute: int = 30

    @model_validator(mode="after")
    def validate_sync_limits(self) -> "Settings":
        if self.sync_max_batch_bytes < self.sync_max_item_bytes:
            raise ValueError("SYNC_MAX_BATCH_BYTES 不得小于 SYNC_MAX_ITEM_BYTES")
        if self.sync_max_request_bytes < self.sync_max_batch_bytes:
            raise ValueError("SYNC_MAX_REQUEST_BYTES 不得小于 SYNC_MAX_BATCH_BYTES")
        if self.deepseek_total_timeout_seconds <= self.deepseek_connect_timeout_seconds:
            raise ValueError(
                "DEEPSEEK_TOTAL_TIMEOUT_SECONDS 必须大于连接超时预算"
            )
        return self

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        """接受常见部署平台给出的同步 URL，并统一切换到异步驱动。"""
        value = value.strip()
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        if value.startswith("sqlite:///"):
            return value.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
        return value

    @field_validator("app_account_url")
    @classmethod
    def validate_app_account_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if not value:
            return ""
        parsed = urlsplit(value)
        localhost = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and not (parsed.scheme == "http" and localhost):
            raise ValueError("APP_ACCOUNT_URL 必须使用 HTTPS（本机开发地址除外）")
        if not parsed.netloc or parsed.username or parsed.password:
            raise ValueError("APP_ACCOUNT_URL 必须是公开且不含凭证的绝对 URL")
        if parsed.query or parsed.fragment:
            raise ValueError("APP_ACCOUNT_URL 不得包含 query 或 fragment")
        return value

    @field_validator("smtp_host", "smtp_user")
    @classmethod
    def validate_smtp_text(cls, value: str) -> str:
        value = value.strip()
        if "\r" in value or "\n" in value:
            raise ValueError("SMTP 配置不得包含换行符")
        return value

    @field_validator("smtp_from")
    @classmethod
    def validate_smtp_from(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return ""
        return str(TypeAdapter(EmailStr).validate_python(value))

    @property
    def volc_tts_auth_headers(self) -> dict[str, str]:
        """语音合成鉴权头。新版 X-Api-Key;旧版 X-Api-App-Id + X-Api-Access-Key。"""
        if self.volc_api_key:
            return {"X-Api-Key": self.volc_api_key}
        if self.volc_app_id and self.volc_access_token:
            return {
                "X-Api-App-Id": self.volc_app_id,
                "X-Api-Access-Key": self.volc_access_token,
            }
        return {}


@lru_cache
def get_settings() -> Settings:
    return Settings()
