# PostgreSQL MCP Server - Installation Guide

Complete guide for installing and configuring the PostgreSQL MCP server with Claude Code.

## Prerequisites

- Python 3.10+ or pipx installed
- PostgreSQL database (local or remote)
- Claude Code CLI installed (for Claude integration)

## Step 1: Install the Package

### Option A: Using pipx (Recommended)

```bash
pipx install postgresql-mcp
```

### Option B: Using pip

```bash
pip install postgresql-mcp
```

### Option C: From Source

```bash
git clone https://github.com/your-username/postgresql-mcp.git
cd postgresql-mcp
uv sync
```

## Step 2: Configure Database Access

The server needs read access to your PostgreSQL database. For security, we recommend creating a dedicated read-only user.

### Creating a Read-Only User (Recommended)

```sql
-- Create a read-only user
CREATE USER mcp_reader WITH PASSWORD 'your_secure_password';

-- Grant connect permission
GRANT CONNECT ON DATABASE your_database TO mcp_reader;

-- Grant usage on schemas
GRANT USAGE ON SCHEMA public TO mcp_reader;

-- Grant select on all tables
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_reader;

-- Grant select on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_reader;

-- Optional: Grant access to other schemas
GRANT USAGE ON SCHEMA other_schema TO mcp_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA other_schema TO mcp_reader;
```

### Required Permissions Summary

| Permission | Required For |
|------------|--------------|
| CONNECT | Connecting to database |
| USAGE ON SCHEMA | Accessing schema objects |
| SELECT ON TABLES | All query and describe operations |
| SELECT ON pg_stat_* | Table statistics (`table_stats`) |

### Optional Write Permissions

If you need write operations (INSERT, UPDATE, DELETE):

```sql
-- Grant write permissions (use with caution!)
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mcp_writer;
```

Then set `ALLOW_WRITE_OPERATIONS=true` in the environment.

## Step 3: Configure Claude Code

### Option A: Using CLI Command (Recommended)

```bash
claude mcp add postgres -s user \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_USER=mcp_reader \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=your_database \
  -- postgresql-mcp
```

### Option B: Manual Configuration

Edit `~/.claude.json` and add to the `mcpServers` section:

```json
{
  "mcpServers": {
    "postgres": {
      "type": "stdio",
      "command": "postgresql-mcp",
      "args": [],
      "env": {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_USER": "mcp_reader",
        "POSTGRES_PASSWORD": "your_password",
        "POSTGRES_DB": "your_database"
      }
    }
  }
}
```

### Option C: Cursor IDE Configuration

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "postgres": {
      "command": "postgresql-mcp",
      "env": {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_USER": "mcp_reader",
        "POSTGRES_PASSWORD": "your_password",
        "POSTGRES_DB": "your_database"
      }
    }
  }
}
```

> **Warning:** Don't commit configuration files with credentials to version control!

## Step 4: Verify Installation

```bash
# Check MCP server is configured
claude mcp list

# Should show:
# postgres: ✓ Connected
```

Start a Claude Code session and test:

```
> List the schemas in my database
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_HOST` | Yes | localhost | Database host |
| `POSTGRES_PORT` | No | 5432 | Database port |
| `POSTGRES_USER` | Yes | postgres | Database user |
| `POSTGRES_PASSWORD` | Yes | - | Database password |
| `POSTGRES_DB` | Yes | postgres | Database name |
| `POSTGRES_SSLMODE` | No | prefer | SSL mode (disable, allow, prefer, require, verify-ca, verify-full) |
| `ALLOW_WRITE_OPERATIONS` | No | false | Enable INSERT/UPDATE/DELETE |
| `QUERY_TIMEOUT` | No | 30 | Query timeout in seconds |
| `MAX_ROWS` | No | 1000 | Maximum rows to return |

## Available Tools (14 total)

### Query Execution
| Tool | Description |
|------|-------------|
| `query` | Execute read-only SQL queries |
| `execute` | Execute write operations (when enabled) |
| `explain_query` | Get EXPLAIN plan for queries |

### Schema Exploration
| Tool | Description |
|------|-------------|
| `list_schemas` | List all schemas |
| `list_tables` | List tables in a schema |
| `describe_table` | Get table structure |
| `list_views` | List views in a schema |
| `describe_view` | Get view definition |

### Performance & Analysis
| Tool | Description |
|------|-------------|
| `table_stats` | Get table statistics |
| `list_indexes` | List table indexes |
| `list_constraints` | List table constraints |
| `list_functions` | List functions/procedures |

### Database Info
| Tool | Description |
|------|-------------|
| `get_database_info` | Get database and connection info |
| `search_columns` | Search columns by name |

## Example Usage

Once configured, you can ask Claude to:

**Schema Exploration:**
- "List all tables in the public schema"
- "Describe the users table"
- "What columns contain 'email' in their name?"

**Query Building:**
- "Show me 10 rows from the orders table"
- "How many records are in each table?"
- "Find orders placed in the last 7 days"

**Performance Analysis:**
- "What indexes exist on the orders table?"
- "Show me the table statistics for users"
- "Explain this query: SELECT * FROM orders WHERE status = 'pending'"

**Documentation:**
- "Generate a data dictionary for this schema"
- "What are the relationships between tables?"

## Connecting to Remote Databases

### AWS RDS

```json
{
  "env": {
    "POSTGRES_HOST": "your-instance.region.rds.amazonaws.com",
    "POSTGRES_PORT": "5432",
    "POSTGRES_USER": "your_user",
    "POSTGRES_PASSWORD": "your_password",
    "POSTGRES_DB": "your_database",
    "POSTGRES_SSLMODE": "require"
  }
}
```

### Supabase

```json
{
  "env": {
    "POSTGRES_HOST": "db.your-project.supabase.co",
    "POSTGRES_PORT": "5432",
    "POSTGRES_USER": "postgres",
    "POSTGRES_PASSWORD": "your_password",
    "POSTGRES_DB": "postgres",
    "POSTGRES_SSLMODE": "require"
  }
}
```

### Docker (Local Development)

```bash
# Start PostgreSQL in Docker
docker run -d \
  --name postgres-dev \
  -e POSTGRES_PASSWORD=devpass \
  -p 5432:5432 \
  postgres:16

# Configure MCP
claude mcp add postgres -s user \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=postgres \
  -- postgresql-mcp
```

## Troubleshooting

### Connection Refused

- Verify PostgreSQL is running: `pg_isready -h localhost -p 5432`
- Check firewall rules allow connection
- Verify host/port in configuration

### Authentication Failed

- Verify username and password
- Check `pg_hba.conf` allows connection from your IP
- Try connecting with psql first: `psql -h localhost -U your_user -d your_database`

### Permission Denied

- Verify user has required permissions (see Step 2)
- Check schema permissions: `GRANT USAGE ON SCHEMA public TO your_user`

### SSL Connection Errors

- Try `POSTGRES_SSLMODE=require` for cloud databases
- Use `POSTGRES_SSLMODE=disable` only for local development

### MCP Server Not Connecting

```bash
# Check server status
claude mcp get postgres

# Verify installation
which postgresql-mcp

# Test server directly (should wait for MCP messages)
postgresql-mcp
# Press Ctrl+C to exit
```

## Security Best Practices

1. **Use read-only users** - Create dedicated users with minimal permissions
2. **Never commit credentials** - Use environment variables or secrets managers
3. **Use SSL for remote connections** - Set `POSTGRES_SSLMODE=require`
4. **Keep write operations disabled** - Only enable when necessary
5. **Limit query results** - Use `MAX_ROWS` to prevent accidental large queries

## Updating

```bash
# Update to latest version
pipx upgrade postgresql-mcp

# Or reinstall
pipx uninstall postgresql-mcp && pipx install postgresql-mcp
```

## Uninstalling

```bash
# Remove from Claude Code
claude mcp remove postgres -s user

# Uninstall package
pipx uninstall postgresql-mcp
```

## Support

- GitHub Issues: https://github.com/your-username/postgresql-mcp/issues
- PyPI: https://pypi.org/project/postgresql-mcp/

