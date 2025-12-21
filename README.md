# PostgreSQL MCP Server

<!-- mcp-name: io.github.JaviMaligno/postgresql -->

[![CI](https://github.com/JaviMaligno/postgres_mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/JaviMaligno/postgres_mcp/actions/workflows/ci.yml)
[![PyPI version](https://badge.fury.io/py/postgresql-mcp.svg)](https://pypi.org/project/postgresql-mcp/)
[![npm version](https://badge.fury.io/js/postgresql-mcp.svg)](https://www.npmjs.com/package/postgresql-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP server for PostgreSQL database operations. Works with Claude Code, Claude Desktop, Cursor, and any MCP-compatible client.

## Language Versions

This repository contains both **TypeScript** and **Python** implementations:

| Version | Directory | Status | Installation |
|---------|-----------|--------|--------------|
| **TypeScript** | `/typescript` | ✅ Recommended (Smithery) | `npm install -g postgresql-mcp` |
| Python | `/python` | ✅ Stable | `pipx install postgresql-mcp` |

> **Note**: The TypeScript version is used for Smithery deployments. Both versions provide identical functionality.

## Features

- **Query Execution**: Execute SQL queries with read-only protection by default
- **Schema Exploration**: List schemas, tables, views, and functions
- **Table Analysis**: Describe structure, indexes, constraints, and statistics
- **Performance Tools**: EXPLAIN queries and analyze table health
- **Security First**: SQL injection prevention, credential protection, read-only by default
- **MCP Prompts**: Guided workflows for exploration, query building, and documentation
- **MCP Resources**: Browsable database structure as markdown

## Quick Start

### TypeScript (Recommended for Smithery)

```bash
# Install globally
npm install -g postgresql-mcp

# Or run directly with npx
npx postgresql-mcp
```

### Python

```bash
# Install
pipx install postgresql-mcp

# Configure Claude Code
claude mcp add postgres -s user \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_USER=your_user \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=your_database \
  -- postgresql-mcp
```

**[Full Installation Guide](docs/INSTALLATION.md)** - Includes database permissions setup, remote connections, and troubleshooting.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_HOST` | | localhost | Database host |
| `POSTGRES_PORT` | | 5432 | Database port |
| `POSTGRES_USER` | ✅ | | Database user |
| `POSTGRES_PASSWORD` | ✅ | | Database password |
| `POSTGRES_DB` | ✅ | | Database name |
| `POSTGRES_SSLMODE` | | prefer | SSL mode |
| `ALLOW_WRITE_OPERATIONS` | | false | Enable INSERT/UPDATE/DELETE |
| `QUERY_TIMEOUT` | | 30 | Query timeout (seconds) |
| `MAX_ROWS` | | 1000 | Maximum rows returned |

### Claude Code CLI

```bash
# TypeScript version
claude mcp add postgres -s user \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_USER=your_user \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=your_database \
  -- npx postgresql-mcp

# Python version
claude mcp add postgres -s user \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_USER=your_user \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=your_database \
  -- postgresql-mcp
```

### Cursor IDE

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["postgresql-mcp"],
      "env": {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_USER": "your_user",
        "POSTGRES_PASSWORD": "your_password",
        "POSTGRES_DB": "your_database"
      }
    }
  }
}
```

## Available Tools (14 total)

### Query Execution
| Tool | Description |
|------|-------------|
| `query` | Execute read-only SQL queries against the database |
| `execute` | Execute write operations (INSERT/UPDATE/DELETE) when enabled |
| `explain_query` | Get EXPLAIN plan for query optimization |

### Schema Exploration
| Tool | Description |
|------|-------------|
| `list_schemas` | List all schemas in the database |
| `list_tables` | List tables in a specific schema |
| `describe_table` | Get table structure (columns, types, constraints) |
| `list_views` | List views in a schema |
| `describe_view` | Get view definition and columns |
| `list_functions` | List functions and procedures |

### Performance & Analysis
| Tool | Description |
|------|-------------|
| `table_stats` | Get table statistics (row count, size, bloat) |
| `list_indexes` | List indexes for a table |
| `list_constraints` | List constraints (PK, FK, UNIQUE, CHECK) |

### Database Info
| Tool | Description |
|------|-------------|
| `get_database_info` | Get database version and connection info |
| `search_columns` | Search for columns by name across all tables |

## MCP Prompts

Guided workflows that help Claude assist you effectively:

| Prompt | Description |
|--------|-------------|
| `explore_database` | Comprehensive database exploration and overview |
| `query_builder` | Help building efficient queries for a table |
| `performance_analysis` | Analyze table performance and suggest optimizations |
| `data_dictionary` | Generate documentation for a schema |

## MCP Resources

Browsable database structure:

| Resource URI | Description |
|--------------|-------------|
| `postgres://schemas` | List all schemas |
| `postgres://schemas/{schema}/tables` | Tables in a schema |
| `postgres://schemas/{schema}/tables/{table}` | Table details |
| `postgres://database` | Database connection info |

## Example Usage

Once configured, ask Claude to:

**Schema Exploration:**
- "List all tables in the public schema"
- "Describe the users table structure"
- "What views are available?"

**Querying:**
- "Show me 10 rows from the orders table"
- "Find all customers who placed orders last week"
- "Count records grouped by status"

**Performance Analysis:**
- "What indexes exist on the orders table?"
- "Analyze the performance of the users table"
- "Explain this query: SELECT * FROM orders WHERE created_at > '2024-01-01'"

**Documentation:**
- "Generate a data dictionary for this database"
- "What columns contain 'email' in their name?"

## Security

This MCP server implements multiple security layers:

### Read-Only by Default
Write operations (INSERT, UPDATE, DELETE) are blocked unless explicitly enabled via `ALLOW_WRITE_OPERATIONS=true`.

### SQL Injection Prevention
- All queries are validated before execution
- Dangerous operations (DROP DATABASE, etc.) are always blocked
- Multiple statements are not allowed
- SQL comments are blocked

### Credential Protection
- Passwords stored using secure string types
- Credentials never appear in logs or error messages

### Query Limits
- Results limited by `MAX_ROWS` (default: 1000)
- Query timeout configurable via `QUERY_TIMEOUT`

## Development

### TypeScript

```bash
cd typescript
npm install
npm run build
npm run dev  # Watch mode
```

### Python

```bash
cd python
uv sync
uv run pytest -v --cov=postgres_mcp
```

### Running Tests

```bash
# Python unit tests (no database required)
cd python
uv run pytest tests/test_security.py tests/test_settings.py -v

# Integration tests (requires PostgreSQL)
docker-compose up -d
uv run pytest tests/test_integration.py -v
```

## Troubleshooting

### Connection Issues

```bash
# Verify PostgreSQL is running
pg_isready -h localhost -p 5432

# Test connection with psql
psql -h localhost -U your_user -d your_database
```

### Permission Denied

Ensure your database user has SELECT permissions:

```sql
GRANT SELECT ON ALL TABLES IN SCHEMA public TO your_user;
```

### MCP Server Not Connecting

```bash
# Check server status
claude mcp get postgres

# Test server directly
postgresql-mcp  # Should wait for MCP messages
```

## Links

- [PyPI Package](https://pypi.org/project/postgresql-mcp/)
- [npm Package](https://www.npmjs.com/package/postgresql-mcp)
- [Installation Guide](docs/INSTALLATION.md)
- [GitHub Repository](https://github.com/JaviMaligno/postgres_mcp)

## License

MIT
