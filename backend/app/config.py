"""服务端配置：全部来自环境变量，绝不硬编码密钥。"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ---- DeepSeek(Text AI)----
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_base_url: str = "https://api.deepseek.com"

    # ---- 火山引擎:新版控制台鉴权(单头 X-Api-Key)----
    volc_api_key: str = ""
    # ---- 火山引擎:旧版控制台鉴权(APP ID + Access Token)----
    volc_app_id: str = ""
    volc_access_token: str = ""
    # ---- 火山引擎语音合成 ----
    volc_endpoint: str = "https://openspeech.bytedance.com"
    volc_tts_resource_id: str = "seed-tts-2.0"  # 语音合成大模型 2.0
    # 默认用基础 uranus 音色(实测稳定可用);控制台开通英语音色后可改
    # en_female_anna_mars_bigtts(英语女声)等
    volc_tts_speaker: str = "zh_female_vv_uranus_bigtts"
    # 音色展示名(可选,只出现在 /health 与设置页,便于人眼确认音色)。
    volc_tts_speaker_name: str = ""

    # ---- 基础限流(默认关闭,预留接口)----
    rate_limit_enabled: bool = False
    rate_limit_per_minute: int = 30

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
