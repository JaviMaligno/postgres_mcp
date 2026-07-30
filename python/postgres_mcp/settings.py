"""Application settings and named PostgreSQL connection configuration."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal
from urllib.parse import parse_qs, unquote, urlparse

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SSLMode = Literal["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]
SSL_MODES = {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}
DEFAULT_ALIAS = "default"
ALIAS_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class Settings(BaseSettings):
    """Global settings plus the backwards-compatible single connection."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_user: str = "postgres"
    postgres_password: SecretStr = SecretStr("postgres")
    postgres_db: str = "postgres"
    postgres_sslmode: SSLMode = "prefer"

    allow_write_operations: bool = False
    query_timeout: int = 30
    max_rows: int = 1000
    pool_min_size: int = 1
    pool_max_size: int = 10

    @field_validator("postgres_port", mode="after")
    @classmethod
    def validate_port(cls, value: int) -> int:
        if not 1 <= value <= 65535:
            raise ValueError("Port must be between 1 and 65535")
        return value

    @field_validator("query_timeout", mode="after")
    @classmethod
    def validate_timeout(cls, value: int) -> int:
        return max(1, min(value, 300))

    @field_validator("max_rows", mode="after")
    @classmethod
    def validate_max_rows(cls, value: int) -> int:
        return max(1, min(value, 100_000))

    @field_validator("pool_min_size", mode="after")
    @classmethod
    def validate_pool_min(cls, value: int) -> int:
        return max(1, min(value, 20))

    @field_validator("pool_max_size", mode="after")
    @classmethod
    def validate_pool_max(cls, value: int) -> int:
        return max(1, min(value, 50))

    def get_connection_string(self) -> str:
        password = self.postgres_password.get_secret_value()
        return (
            f"postgresql://{self.postgres_user}:{password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
            f"?sslmode={self.postgres_sslmode}"
        )

    def get_connection_dict(self) -> dict:
        return {
            "host": self.postgres_host,
            "port": self.postgres_port,
            "user": self.postgres_user,
            "password": self.postgres_password.get_secret_value(),
            "database": self.postgres_db,
            "sslmode": self.postgres_sslmode,
            "connect_timeout": self.query_timeout,
        }


@dataclass(frozen=True)
class Connection:
    """Resolved internal connection. Credentials never leave this object."""

    alias: str
    host: str
    port: int
    user: str
    password: SecretStr
    database: str
    sslmode: SSLMode
    allow_write: bool
    is_default: bool

    def get_connection_dict(self, query_timeout: int) -> dict:
        return {
            "host": self.host,
            "port": self.port,
            "user": self.user,
            "password": self.password.get_secret_value(),
            "database": self.database,
            "sslmode": self.sslmode,
            "connect_timeout": query_timeout,
        }


def _validate_port(value: object, alias: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f'Connection "{alias}" has an invalid port')
    try:
        port = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f'Connection "{alias}" has an invalid port') from error
    if not 1 <= port <= 65535:
        raise ValueError(f'Connection "{alias}" has an invalid port')
    return port


def _dsn_fields(alias: str, value: str) -> dict[str, object]:
    parsed = urlparse(value)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError(
            f'Connection "{alias}" must use a postgres:// or postgresql:// URL'
        )
    database = unquote(parsed.path.lstrip("/"))
    if not database:
        raise ValueError(f'Connection "{alias}" URL has no database name')
    sslmode = parse_qs(parsed.query).get("sslmode", [None])[0]
    if sslmode is not None and sslmode not in SSL_MODES:
        raise ValueError(f'Connection "{alias}" has unknown sslmode "{sslmode}"')
    return {
        "host": parsed.hostname or "localhost",
        "port": parsed.port or 5432,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "database": database,
        "sslmode": sslmode,
    }


def _connection_from_item(item: object, default_write: bool) -> Connection:
    if not isinstance(item, dict):
        raise ValueError("Each POSTGRES_CONNECTIONS entry must be an object")
    alias = item.get("alias")
    if not isinstance(alias, str) or not ALIAS_PATTERN.fullmatch(alias):
        raise ValueError(
            "Connection alias is required and may contain only letters, digits, "
            "hyphens and underscores"
        )

    url = item.get("url")
    if url is not None and not isinstance(url, str):
        raise ValueError(f'Connection "{alias}" URL must be a string')
    dsn = _dsn_fields(alias, url) if url else {}

    host = item.get("host", dsn.get("host", "localhost"))
    port = _validate_port(item.get("port", dsn.get("port", 5432)), alias)
    user = item.get("user", dsn.get("user", ""))
    password = item.get("password", dsn.get("password", ""))
    database = item.get("database", dsn.get("database", ""))
    sslmode = item.get("sslmode", dsn.get("sslmode") or "prefer")
    allow_write = item.get("allowWrite", default_write)
    is_default = item.get("default", False)

    if not isinstance(host, str) or not host:
        raise ValueError(f'Connection "{alias}" is missing a host')
    if not isinstance(user, str) or not user:
        raise ValueError(f'Connection "{alias}" is missing a user')
    if not isinstance(password, str):
        raise ValueError(f'Connection "{alias}" password must be a string')
    if not isinstance(database, str) or not database:
        raise ValueError(f'Connection "{alias}" is missing a database name')
    if sslmode not in SSL_MODES:
        raise ValueError(f'Connection "{alias}" has unknown sslmode "{sslmode}"')
    if not isinstance(allow_write, bool):
        raise ValueError(f'Connection "{alias}" allowWrite must be boolean')
    if not isinstance(is_default, bool):
        raise ValueError(f'Connection "{alias}" default must be boolean')

    return Connection(
        alias=alias,
        host=host,
        port=port,
        user=user,
        password=SecretStr(password),
        database=database,
        sslmode=sslmode,
        allow_write=allow_write,
        is_default=is_default,
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


@lru_cache
def get_connections() -> tuple[Connection, ...]:
    settings = get_settings()
    raw = os.environ.get("POSTGRES_CONNECTIONS")
    if not raw:
        return (
            Connection(
                alias=DEFAULT_ALIAS,
                host=settings.postgres_host,
                port=settings.postgres_port,
                user=settings.postgres_user,
                password=settings.postgres_password,
                database=settings.postgres_db,
                sslmode=settings.postgres_sslmode,
                allow_write=settings.allow_write_operations,
                is_default=True,
            ),
        )

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("POSTGRES_CONNECTIONS is not valid JSON") from error
    if not isinstance(parsed, list):
        raise ValueError("POSTGRES_CONNECTIONS must be a JSON array")
    if not parsed:
        raise ValueError("POSTGRES_CONNECTIONS is empty")

    connections = tuple(
        _connection_from_item(item, settings.allow_write_operations) for item in parsed
    )
    aliases = [connection.alias for connection in connections]
    duplicates = sorted({alias for alias in aliases if aliases.count(alias) > 1})
    if duplicates:
        raise ValueError(f'duplicate connection alias: {", ".join(duplicates)}')

    defaults = [connection.alias for connection in connections if connection.is_default]
    if len(defaults) > 1:
        raise ValueError(f'More than one default connection: {", ".join(defaults)}')
    default_alias = defaults[0] if defaults else connections[0].alias

    return tuple(
        Connection(
            alias=connection.alias,
            host=connection.host,
            port=connection.port,
            user=connection.user,
            password=connection.password,
            database=connection.database,
            sslmode=connection.sslmode,
            allow_write=connection.allow_write,
            is_default=connection.alias == default_alias,
        )
        for connection in connections
    )


def list_connections() -> list[dict[str, object]]:
    """Return safe connection summaries without credentials."""
    return [
        {
            "alias": connection.alias,
            "host": connection.host,
            "port": connection.port,
            "database": connection.database,
            "allowWrite": connection.allow_write,
            "isDefault": connection.is_default,
        }
        for connection in get_connections()
    ]


def resolve_connection(alias: str | None = None) -> Connection:
    connections = get_connections()
    if not alias:
        return next(
            (connection for connection in connections if connection.is_default),
            connections[0],
        )
    for connection in connections:
        if connection.alias == alias:
            return connection
    available = ", ".join(connection.alias for connection in connections)
    raise ValueError(f'Unknown database "{alias}". Configured connections: {available}')


def clear_settings_cache() -> None:
    get_settings.cache_clear()
    get_connections.cache_clear()
