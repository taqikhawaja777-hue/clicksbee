from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    supabase_url: str
    supabase_key: str
    cors_origins: str = "http://localhost:5173"
    port: int = 8000

    # Jibble sync (optional - the app still runs without these; the sync
    # job and any endpoint that touches Jibble raise a clear error if a
    # request actually needs them and they're unset)
    jibble_client_id: str = ""
    jibble_client_secret: str = ""
    jibble_organization_id: str = ""
    jibble_token_url: str = "https://identity.prod.jibble.io/connect/token"
    jibble_workspace_base_url: str = "https://workspace.prod.jibble.io/v1"
    jibble_time_tracking_base_url: str = "https://time-tracking.prod.jibble.io/v1"
    jibble_sync_interval_minutes: int = 5

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
