# PostgreSQL MCP Server

A Model Context Protocol (MCP) server for PostgreSQL that provides tools for database querying, schema exploration, and table management.

## Features

- **Query**: Execute SQL queries against PostgreSQL databases
- **List Schemas**: List all available schemas in the database
- **List Tables**: List all tables in a specific schema
- **Describe Table**: Get detailed information about table structure, columns, constraints, and relationships

## Installation

### Prerequisites

- Python 3.10+
- Poetry
- PostgreSQL database (can be running in Docker)

### Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd postgres_mcp
```

2. Install dependencies using Poetry:

```bash
poetry install
```

3. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your database connection details
```

## Configuration

The server uses environment variables for database connection:

```env
POSTGRES_HOST=your_host
POSTGRES_PORT=your_port
POSTGRES_USER=your_user
POSTGRES_PASSWORD=your_password
POSTGRES_DB=your_db
```

## Usage

### Running Locally

```bash
# Install dependencies
poetry install

# Run the MCP server
poetry run postgres-mcp
```

### Configuring with Cursor IDE

To use this MCP server with Cursor IDE:

1. **Install the MCP server** in your project directory:

   ```bash
   poetry install
   ```
2. **Find your Poetry virtual environment path**:

   ```bash
   poetry env info
   ```

   Look for the "Executable" path, which will be something like:
   `/Users/your-username/Library/Caches/pypoetry/virtualenvs/postgres-mcp-XXXXXX-py3.12/bin/python`
3. **Configure Cursor MCP settings**:
   Open Cursor settings and add the following to your MCP configuration (usually in `~/.cursor/mcp.json`):

   ```json
   {
     "mcpServers": {
       "postgres-mcp": {
         "command": "/Users/your-username/Library/Caches/pypoetry/virtualenvs/postgres-mcp-XXXXXX-py3.12/bin/python",
         "args": ["-m", "postgres_mcp.server"],
         "env": {
           "POSTGRES_HOST": "your_host",
           "POSTGRES_PORT": "your_port",
           "POSTGRES_USER": "your_user",
           "POSTGRES_PASSWORD": "your_passowrd",
           "POSTGRES_DB": "your_database_name",
           "PYTHONPATH": "/path/to/your/postgres_mcp/project"
         }
       }
     }
   }
   ```
4. **Update the configuration** with your specific paths and database details:

   - Replace the `command` path with your actual Poetry virtual environment Python executable
   - Update the `PYTHONPATH` with your project directory path
   - Set your database connection details in the `env` section
5. **Restart Cursor** to load the new MCP server configuration.
6. **Verify the tools are available** in Cursor's MCP panel. You should see four tools:

   - `query` - Execute SQL queries
   - `list_schemas` - List database schemas
   - `list_tables` - List tables in a schema
   - `describe_table` - Get table structure details

**Example working configuration:**

```json
{
  "mcpServers": {
    "postgres-mcp": {
      "command": "/Users/javieraguilarmartin1/Library/Caches/pypoetry/virtualenvs/postgres-mcp-1M6poMko-py3.12/bin/python",
      "args": ["-m", "postgres_mcp.server"],
      "env": {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "postgres",
        "POSTGRES_DB": "light_wash",
        "PYTHONPATH": "/Users/javieraguilarmartin1/Documents/repos/postgres_mcp"
      }
    }
  }
}
```

### Running with Docker

Build and run the Docker container:

```bash
# Build the image
docker build -t postgres-mcp .

# Run the container
docker run -it --env-file .env postgres-mcp
```

### Running with Docker Compose

For a complete setup including PostgreSQL:

```bash
# Start both PostgreSQL and MCP server
docker-compose up

# Run in detached mode
docker-compose up -d

# Stop services
docker-compose down
```

## Available Tools

### 1. Query Tool

Execute SQL queries against the database.

**Parameters:**

- `sql` (required): SQL query to execute

**Example:**

```json
{
  "name": "query",
  "arguments": {
    "sql": "SELECT * FROM users LIMIT 10"
  }
}
```

### 2. List Schemas Tool

List all schemas in the database.

**Parameters:** None

**Example:**

```json
{
  "name": "list_schemas",
  "arguments": {}
}
```

### 3. List Tables Tool

List all tables in a specific schema.

**Parameters:**

- `schema` (optional): Schema name (default: "public")

**Example:**

```json
{
  "name": "list_tables",
  "arguments": {
    "schema": "public"
  }
}
```

### 4. Describe Table Tool

Get detailed information about a table's structure.

**Parameters:**

- `table_name` (required): Name of the table to describe
- `schema` (optional): Schema name (default: "public")

**Example:**

```json
{
  "name": "describe_table",
  "arguments": {
    "table_name": "users",
    "schema": "public"
  }
}
```

## Development

### Running Tests

```bash
poetry run pytest
```

### Code Formatting

```bash
# Format code
poetry run black .

# Check linting
poetry run flake8 .

# Type checking
poetry run mypy .
```

## Architecture

The MCP server is built using:

- **MCP SDK**: For Model Context Protocol implementation
- **psycopg2**: For PostgreSQL database connectivity
- **asyncio**: For asynchronous operations
- **Poetry**: For dependency management

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Database Connection Issues

1. Ensure PostgreSQL is running and accessible
2. Check your environment variables
3. Verify network connectivity if using Docker

### MCP Server Issues

1. Check the logs for detailed error messages
2. Ensure all dependencies are installed
3. Verify Python version compatibility

## Support

For issues and questions, please open an issue in the GitHub repository.
