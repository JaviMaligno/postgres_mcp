# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an MCP (Model Context Protocol) server for PostgreSQL database operations. It provides tools for querying databases, exploring schemas, managing tables, and analyzing performance. The server works with Claude Code, Claude Desktop, and any MCP-compatible client.

## Development Commands

```bash
# Install dependencies
uv sync

# Run MCP server (stdio mode for Claude Desktop/Code)
uv run python -m postgres_mcp.server

# Run tests
uv run pytest -v

# Run tests with coverage
uv run pytest -v --cov=postgres_mcp --cov-report=term-missing

# Build package
uv build

# Publish to PyPI
uv publish
```

## Architecture

The codebase has a modular architecture:

- **`postgres_mcp/server.py`**: FastMCP server that defines all MCP tools, prompts, and resources. Each tool is a decorated function (`@mcp.tool()`) that wraps PostgresClient methods.

- **`postgres_mcp/__version__.py`**: Centralized version management.

- **`postgres_mcp/postgres_client.py`**: Low-level database client using psycopg2. Provides connection management and all database operations (queries, schema inspection, statistics).

- **`postgres_mcp/settings.py`**: Centralized configuration using pydantic-settings. Loads environment variables and `.env` files. Credentials stored securely with `SecretStr`.

- **`postgres_mcp/security.py`**: Security utilities including SQL validation, identifier sanitization, and injection prevention.

- **`postgres_mcp/models.py`**: Pydantic models for response transformation and type safety.

- **`postgres_mcp/utils.py`**: Shared utilities (formatting, error handling decorators).

## Security Features

The server implements multiple security layers:

1. **SQL Injection Prevention**: The `validate_query()` function blocks dangerous operations and validates all SQL before execution.

2. **Read-Only by Default**: Write operations (INSERT, UPDATE, DELETE) are blocked unless `ALLOW_WRITE_OPERATIONS=true` is set.

3. **Identifier Sanitization**: Schema and table names are validated with `validate_identifier()` and escaped with `psycopg2.sql.Identifier`.

4. **Credential Protection**: Passwords are stored as `SecretStr` and never logged.

5. **Query Limits**: Results are limited by `MAX_ROWS` to prevent DoS.

## Configuration

Required environment variables:
- `POSTGRES_HOST`: Database host (default: localhost)
- `POSTGRES_PORT`: Database port (default: 5432)
- `POSTGRES_USER`: Database user
- `POSTGRES_PASSWORD`: Database password
- `POSTGRES_DB`: Database name

Optional configuration:
- `ALLOW_WRITE_OPERATIONS`: Allow INSERT/UPDATE/DELETE (default: false)
- `QUERY_TIMEOUT`: Query timeout in seconds (default: 30)
- `MAX_ROWS`: Maximum rows to return (default: 1000)
- `POSTGRES_SSLMODE`: SSL mode (default: prefer)

## Adding New Tools

1. Add the database method to `PostgresClient` in `postgres_mcp/postgres_client.py`
2. Create the MCP tool wrapper in `postgres_mcp/server.py` using `@mcp.tool()` decorator
3. Add any new models to `postgres_mcp/models.py`
4. Add tests for the new functionality

## Testing

Tests are in the `tests/` directory:

- `test_security.py`: SQL validation and injection prevention
- `test_settings.py`: Configuration and environment variables
- `test_models.py`: Pydantic model transformations
- `test_utils.py`: Utility functions

Run tests locally:
```bash
uv run pytest -v
```

For integration tests, a PostgreSQL database is required. CI uses GitHub Actions with a Postgres service container.

## MCP Features

### Tools (14 total)
- `query`: Execute read-only SQL queries
- `execute`: Execute write operations (when enabled)
- `explain_query`: Get EXPLAIN plan
- `list_schemas`: List database schemas
- `list_tables`: List tables in schema
- `describe_table`: Get table structure
- `table_stats`: Get table statistics
- `list_indexes`: List table indexes
- `list_constraints`: List table constraints
- `list_views`: List views
- `describe_view`: Get view definition
- `list_functions`: List functions/procedures
- `get_database_info`: Get database info
- `search_columns`: Search columns by name

### Resources
- `postgres://schemas`: List all schemas
- `postgres://schemas/{schema}/tables`: List tables
- `postgres://schemas/{schema}/tables/{table}`: Table details
- `postgres://database`: Database info

### Prompts
- `explore_database`: Database exploration guide
- `query_builder`: Help building queries
- `performance_analysis`: Table performance analysis
- `data_dictionary`: Generate documentation

## Release Process

1. Update version in `postgres_mcp/__version__.py`
2. Commit and push to main
3. Create and push tag: `git tag v0.x.x && git push origin v0.x.x`
4. GitHub Actions will run tests and publish to PyPI

