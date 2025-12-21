"""PostgreSQL MCP Server Package.

A Model Context Protocol (MCP) server for PostgreSQL that provides tools
for database querying, schema exploration, and table management.
"""

from postgres_mcp.__version__ import __version__
from postgres_mcp.postgres_client import PostgresClient, get_client
from postgres_mcp.settings import Settings, get_settings
from postgres_mcp.security import (
    SQLValidationError,
    validate_query,
    validate_identifier,
    safe_identifier,
    safe_schema_table,
)

__all__ = [
    "__version__",
    "PostgresClient",
    "get_client",
    "Settings",
    "get_settings",
    "SQLValidationError",
    "validate_query",
    "validate_identifier",
    "safe_identifier",
    "safe_schema_table",
]
