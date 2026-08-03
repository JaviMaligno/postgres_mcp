# postgresql-mcp (Python)

<!-- mcp-name: io.github.JaviMaligno/postgresql -->

MCP server for PostgreSQL database operations. Works with Claude Code, Claude Desktop, Cursor, and any MCP-compatible client.

This is the **Python** implementation. A TypeScript implementation with the same
tool set lives in [`/typescript`](https://github.com/JaviMaligno/postgres_mcp/tree/main/typescript)
and is published to npm as `postgresql-mcp`.

> This file used to be a symlink to the repository root README. That made the
> published source distribution carry a dangling link, which broke the wheel
> build — so it is a real file now, deliberately kept short. **The full
> documentation is in the [repository README](https://github.com/JaviMaligno/postgres_mcp#readme).**

## Install

```bash
pipx install postgresql-mcp
```

## Configure

```bash
claude mcp add postgres -s user \
  -e POSTGRES_HOST=localhost \
  -e POSTGRES_USER=your_user \
  -e POSTGRES_PASSWORD=your_password \
  -e POSTGRES_DB=your_database \
  -- postgresql-mcp
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTGRES_HOST` | | `localhost` | Database host |
| `POSTGRES_PORT` | | `5432` | Database port |
| `POSTGRES_USER` | ✅ | | Database user |
| `POSTGRES_PASSWORD` | ✅ | | Database password |
| `POSTGRES_DB` | ✅ | | Database name |
| `POSTGRES_SSLMODE` | | `prefer` | SSL mode |
| `ALLOW_WRITE_OPERATIONS` | | `false` | Enable INSERT/UPDATE/DELETE |
| `QUERY_TIMEOUT` | | `30` | Query timeout in seconds |
| `MAX_ROWS` | | `1000` | Maximum rows returned per query |

## What it provides

- **15 tools** — query execution, schema exploration, table analysis, EXPLAIN plans
- **4 prompts** — guided workflows for exploration, query building, performance analysis and documentation
- **Named databases** — select a configured connection per tool call without exposing credentials
- **Resources** — browsable database structure as markdown
- **Read-only by default**, with SQL injection prevention and credential protection

See the [full documentation](https://github.com/JaviMaligno/postgres_mcp#readme) for
the complete tool reference, security model, and the
[installation guide](https://github.com/JaviMaligno/postgres_mcp/blob/main/docs/INSTALLATION.md)
for database permissions and remote connections.

## License

MIT
