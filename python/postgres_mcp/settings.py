"""Application settings using pydantic-settings.

Centralizes all environment variable configuration for the MCP server.
Supports .env files and environment variables.

Usage:
    from postgres_mcp.settings import get_settings
    
    settings = get_settings()
    host = settings.postgres_host
"""

from functools import lru_cache
from typing import Literal, Optional

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables.
    
    Environment Variables:
        POSTGRES_HOST: Database host (default: localhost)
        POSTGRES_PORT: Database port (default: 5432)
        POSTGRES_USER: Database user (default: postgres)
        POSTGRES_PASSWORD: Database password (required)
        POSTGRES_DB: Database name (default: postgres)
        POSTGRES_SSLMODE: SSL mode (default: prefer)
        ALLOW_WRITE_OPERATIONS: Allow INSERT/UPDATE/DELETE (default: false)
        QUERY_TIMEOUT: Query timeout in seconds (default: 30)
        MAX_ROWS: Maximum rows to return (default: 1000)
    """
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )
    
    # PostgreSQL connection settings
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "postgres"
    postgres_password: SecretStr = SecretStr("postgres")
    postgres_db: str = "postgres"
    postgres_sslmode: Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"] = "prefer"
    
    # Security settings
    allow_write_operations: bool = False
    
    # Query settings
    query_timeout: int = 30  # seconds
    max_rows: int = 1000
    
    # Connection pool settings
    pool_min_size: int = 1
    pool_max_size: int = 10
    
    @field_validator("postgres_port", mode="after")
    @classmethod
    def validate_port(cls, v: int) -> int:
        """Ensure port is in valid range."""
        if not 1 <= v <= 65535:
            raise ValueError("Port must be between 1 and 65535")
        return v
    
    @field_validator("query_timeout", mode="after")
    @classmethod
    def validate_timeout(cls, v: int) -> int:
        """Ensure timeout is reasonable (1-300 seconds)."""
        return max(1, min(v, 300))
    
    @field_validator("max_rows", mode="after")
    @classmethod
    def validate_max_rows(cls, v: int) -> int:
        """Ensure max_rows is reasonable (1-100000)."""
        return max(1, min(v, 100_000))
    
    @field_validator("pool_min_size", mode="after")
    @classmethod
    def validate_pool_min(cls, v: int) -> int:
        """Ensure pool_min_size is reasonable."""
        return max(1, min(v, 20))
    
    @field_validator("pool_max_size", mode="after")
    @classmethod
    def validate_pool_max(cls, v: int) -> int:
        """Ensure pool_max_size is reasonable."""
        return max(1, min(v, 50))
    
    def get_connection_string(self) -> str:
        """Build a PostgreSQL connection string.
        
        Returns:
            Connection string in the format:
            postgresql://user:password@host:port/database?sslmode=mode
        """
        password = self.postgres_password.get_secret_value()
        return (
            f"postgresql://{self.postgres_user}:{password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
            f"?sslmode={self.postgres_sslmode}"
        )
    
    def get_connection_dict(self) -> dict:
        """Get connection parameters as a dictionary.
        
        Returns:
            Dictionary with connection parameters for psycopg2.connect()
        """
        return {
            "host": self.postgres_host,
            "port": self.postgres_port,
            "user": self.postgres_user,
            "password": self.postgres_password.get_secret_value(),
            "database": self.postgres_db,
            "sslmode": self.postgres_sslmode,
            "connect_timeout": self.query_timeout,
        }


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.
    
    Returns:
        Settings instance loaded from environment
    """
    return Settings()


def clear_settings_cache() -> None:
    """Clear the settings cache.
    
    Useful for testing when environment variables change.
    """
    get_settings.cache_clear()

