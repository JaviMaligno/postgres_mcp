#!/usr/bin/env python3
"""PostgreSQL MCP Server using FastMCP.

Provides tools for interacting with PostgreSQL databases,
including querying, schema exploration, and table management.

Usage:
    # Run as stdio server (for Claude Desktop/Code)
    python -m postgres_mcp.server
    
    # Or via entry point
    postgres-mcp
"""

import json
from typing import Optional

from mcp.server.fastmcp import FastMCP

from postgres_mcp.__version__ import __version__
from postgres_mcp.postgres_client import PostgresClient, PostgresClientError, get_client
from postgres_mcp.settings import get_settings
from postgres_mcp.security import SQLValidationError, sanitize_limit
from postgres_mcp.utils import format_bytes, format_count, handle_db_error, not_found_response
from postgres_mcp.models import (
    ColumnInfo,
    ConstraintInfo,
    IndexInfo,
    SchemaSummary,
    TableDetail,
    TableStats,
    TableSummary,
    ViewDetail,
    ViewSummary,
    FunctionSummary,
)

# Initialize FastMCP server
mcp = FastMCP(
    "postgres",
    instructions=f"PostgreSQL MCP Server v{__version__} - Tools for PostgreSQL database operations",
)


# ==================== QUERY TOOLS ====================


@mcp.tool()
@handle_db_error
def query(sql: str) -> dict:
    """Execute a SQL query against the PostgreSQL database.
    
    This tool is READ-ONLY by default. Use the 'execute' tool for write operations.
    
    Args:
        sql: SQL query to execute (SELECT statements only)
        
    Returns:
        Query results with rows, columns, and metadata
    """
    client = get_client()
    settings = get_settings()
    
    result = client.execute_query(sql, allow_write=False, max_rows=settings.max_rows)
    
    return {
        "rows": result["rows"],
        "row_count": result["row_count"],
        "columns": result["columns"],
        "truncated": result.get("truncated", False),
    }


@mcp.tool()
@handle_db_error
def execute(sql: str) -> dict:
    """Execute a write SQL statement (INSERT, UPDATE, DELETE).
    
    WARNING: This tool modifies data. Use with caution.
    Only available if ALLOW_WRITE_OPERATIONS=true is set.
    
    Args:
        sql: SQL statement to execute
        
    Returns:
        Execution result with affected row count
    """
    settings = get_settings()
    
    if not settings.allow_write_operations:
        return {
            "success": False,
            "error": "Write operations are disabled. Set ALLOW_WRITE_OPERATIONS=true to enable.",
        }
    
    client = get_client()
    result = client.execute_query(sql, allow_write=True)
    
    return {
        "success": True,
        "row_count": result["row_count"],
        "message": result.get("message", "Query executed successfully"),
    }


@mcp.tool()
@handle_db_error
def explain_query(sql: str, analyze: bool = False) -> dict:
    """Get the execution plan for a SQL query (EXPLAIN).
    
    Args:
        sql: SQL query to explain
        analyze: If true, actually runs the query to get real execution stats
                 (EXPLAIN ANALYZE). Use with caution on slow queries.
        
    Returns:
        Execution plan in JSON format with cost estimates
    """
    client = get_client()
    return client.explain_query(sql, analyze=analyze)


# ==================== SCHEMA TOOLS ====================


@mcp.tool()
@handle_db_error
def list_schemas() -> dict:
    """List all schemas in the PostgreSQL database.
    
    Returns:
        List of schemas with name and owner
    """
    client = get_client()
    schemas = client.list_schemas()
    
    return {
        "schemas": [SchemaSummary.from_row(s).model_dump() for s in schemas],
    }


# ==================== TABLE TOOLS ====================


@mcp.tool()
@handle_db_error
def list_tables(schema: str = "public") -> dict:
    """List all tables in a specific schema.
    
    Args:
        schema: Schema name to list tables from (default: public)
        
    Returns:
        List of tables with name and type
    """
    client = get_client()
    tables = client.list_tables(schema)
    
    return {
        "schema": schema,
        "tables": [TableSummary.from_row(t).model_dump() for t in tables],
    }


@mcp.tool()
@handle_db_error
def describe_table(table_name: str, schema: str = "public") -> dict:
    """Describe the structure of a table including columns, types, and constraints.
    
    Args:
        table_name: Name of the table to describe
        schema: Schema name (default: public)
        
    Returns:
        Table structure with columns, primary keys, and foreign keys
    """
    client = get_client()
    result = client.describe_table(table_name, schema)
    
    if not result["columns"]:
        return not_found_response("Table", f"{schema}.{table_name}")
    
    # Transform columns
    columns = [
        ColumnInfo.from_row(col, result["primary_keys"]).model_dump()
        for col in result["columns"]
    ]
    
    return {
        "schema": schema,
        "table_name": table_name,
        "columns": columns,
        "primary_keys": result["primary_keys"],
        "foreign_keys": result["foreign_keys"],
    }


@mcp.tool()
@handle_db_error
def table_stats(table_name: str, schema: str = "public") -> dict:
    """Get statistics for a table (row count, size, bloat).
    
    Args:
        table_name: Name of the table
        schema: Schema name (default: public)
        
    Returns:
        Table statistics including row count, sizes, and vacuum info
    """
    client = get_client()
    stats = client.get_table_stats(table_name, schema)
    
    if not stats:
        return not_found_response("Table", f"{schema}.{table_name}")
    
    return {
        "schema": schema,
        "table_name": table_name,
        "row_count": stats.get("row_count"),
        "row_count_formatted": format_count(stats.get("row_count")),
        "dead_tuples": stats.get("dead_tuples"),
        "total_size": stats.get("total_size"),
        "total_size_formatted": format_bytes(stats.get("total_size")),
        "table_size": stats.get("table_size"),
        "table_size_formatted": format_bytes(stats.get("table_size")),
        "index_size": stats.get("index_size"),
        "index_size_formatted": format_bytes(stats.get("index_size")),
        "last_vacuum": str(stats.get("last_vacuum")) if stats.get("last_vacuum") else None,
        "last_analyze": str(stats.get("last_analyze")) if stats.get("last_analyze") else None,
    }


# ==================== INDEX TOOLS ====================


@mcp.tool()
@handle_db_error
def list_indexes(table_name: str, schema: str = "public") -> dict:
    """List all indexes for a table.
    
    Args:
        table_name: Name of the table
        schema: Schema name (default: public)
        
    Returns:
        List of indexes with name, columns, type, and size
    """
    client = get_client()
    indexes = client.list_indexes(table_name, schema)
    
    return {
        "table_name": table_name,
        "schema": schema,
        "indexes": [
            {
                "name": idx["index_name"],
                "is_unique": idx.get("is_unique", False),
                "is_primary": idx.get("is_primary", False),
                "type": idx.get("index_type", "btree"),
                "size": format_bytes(idx.get("size_bytes")),
                "definition": idx.get("definition", ""),
            }
            for idx in indexes
        ],
    }


# ==================== CONSTRAINT TOOLS ====================


@mcp.tool()
@handle_db_error
def list_constraints(table_name: str, schema: str = "public") -> dict:
    """List all constraints for a table (PK, FK, UNIQUE, CHECK).
    
    Args:
        table_name: Name of the table
        schema: Schema name (default: public)
        
    Returns:
        List of constraints with type, columns, and references
    """
    client = get_client()
    constraints = client.list_constraints(table_name, schema)
    
    # Group by constraint name to handle multi-column constraints
    grouped = {}
    for c in constraints:
        name = c["constraint_name"]
        if name not in grouped:
            grouped[name] = {
                "name": name,
                "type": c["constraint_type"],
                "columns": [],
                "references_table": c.get("references_table"),
                "references_column": c.get("references_column"),
                "check_clause": c.get("check_clause"),
            }
        if c.get("column_name"):
            grouped[name]["columns"].append(c["column_name"])
    
    return {
        "table_name": table_name,
        "schema": schema,
        "constraints": list(grouped.values()),
    }


# ==================== VIEW TOOLS ====================


@mcp.tool()
@handle_db_error
def list_views(schema: str = "public") -> dict:
    """List all views in a schema.
    
    Args:
        schema: Schema name (default: public)
        
    Returns:
        List of views with name
    """
    client = get_client()
    views = client.list_views(schema)
    
    return {
        "schema": schema,
        "views": [ViewSummary.from_row(v).model_dump() for v in views],
    }


@mcp.tool()
@handle_db_error
def describe_view(view_name: str, schema: str = "public") -> dict:
    """Get the definition and columns of a view.
    
    Args:
        view_name: Name of the view
        schema: Schema name (default: public)
        
    Returns:
        View definition SQL and column list
    """
    client = get_client()
    result = client.describe_view(view_name, schema)
    
    if not result["definition"]:
        return not_found_response("View", f"{schema}.{view_name}")
    
    return result


# ==================== FUNCTION TOOLS ====================


@mcp.tool()
@handle_db_error
def list_functions(schema: str = "public") -> dict:
    """List all functions and procedures in a schema.
    
    Args:
        schema: Schema name (default: public)
        
    Returns:
        List of functions with name, arguments, and return type
    """
    client = get_client()
    functions = client.list_functions(schema)
    
    return {
        "schema": schema,
        "functions": [FunctionSummary.from_row(f).model_dump() for f in functions],
    }


# ==================== DATABASE INFO TOOLS ====================


@mcp.tool()
@handle_db_error
def get_database_info() -> dict:
    """Get database and connection information.
    
    Returns:
        Database version, connection info, and settings
    """
    client = get_client()
    return client.get_database_info()


# ==================== SEARCH TOOLS ====================


@mcp.tool()
@handle_db_error
def search_columns(search_term: str, schema: Optional[str] = None) -> dict:
    """Search for columns by name across all tables.
    
    Args:
        search_term: Column name pattern to search (case-insensitive)
        schema: Optional schema to limit search (default: all user schemas)
        
    Returns:
        List of matching columns with table information
    """
    client = get_client()
    columns = client.search_columns(search_term, schema)
    
    return {
        "search_term": search_term,
        "schema_filter": schema,
        "matches": columns,
        "count": len(columns),
    }


# ==================== MCP RESOURCES ====================


@mcp.resource("postgres://schemas")
def resource_schemas() -> str:
    """List all schemas in the database.
    
    Returns a summary of schemas for browsing.
    """
    client = get_client()
    schemas = client.list_schemas()
    
    lines = ["# Database Schemas", ""]
    for s in schemas:
        name = s.get("schema_name", "unknown")
        owner = s.get("schema_owner", "")
        lines.append(f"- **{name}** (owner: {owner})")
    
    return "\n".join(lines)


@mcp.resource("postgres://schemas/{schema}/tables")
def resource_tables(schema: str) -> str:
    """List tables in a specific schema.
    
    Args:
        schema: Schema name
    """
    client = get_client()
    tables = client.list_tables(schema)
    
    lines = [f"# Tables in '{schema}'", ""]
    if not tables:
        lines.append("No tables found.")
    for t in tables:
        name = t.get("table_name", "unknown")
        ttype = t.get("table_type", "BASE TABLE")
        icon = "📋" if ttype == "BASE TABLE" else "👁"
        lines.append(f"- {icon} **{name}** ({ttype})")
    
    return "\n".join(lines)


@mcp.resource("postgres://schemas/{schema}/tables/{table}")
def resource_table_detail(schema: str, table: str) -> str:
    """Get detailed information about a table.
    
    Args:
        schema: Schema name
        table: Table name
    """
    client = get_client()
    info = client.describe_table(table, schema)
    
    lines = [f"# {schema}.{table}", ""]
    
    # Columns
    lines.append("## Columns")
    lines.append("")
    lines.append("| Column | Type | Nullable | Default | PK |")
    lines.append("|--------|------|----------|---------|-----|")
    
    pk_set = set(info.get("primary_keys", []))
    for col in info.get("columns", []):
        name = col.get("column_name", "")
        dtype = col.get("data_type", "")
        nullable = "✓" if col.get("is_nullable") == "YES" else "✗"
        default = col.get("column_default", "") or "-"
        pk = "🔑" if name in pk_set else ""
        lines.append(f"| {name} | {dtype} | {nullable} | {default} | {pk} |")
    
    # Foreign Keys
    fks = info.get("foreign_keys", [])
    if fks:
        lines.append("")
        lines.append("## Foreign Keys")
        lines.append("")
        for fk in fks:
            lines.append(f"- {fk['column']} → {fk['references']}")
    
    return "\n".join(lines)


@mcp.resource("postgres://database")
def resource_database() -> str:
    """Get database information."""
    client = get_client()
    info = client.get_database_info()
    
    lines = [
        f"# Database: {info.get('database', 'unknown')}",
        "",
        f"**Version**: {info.get('version', 'unknown')}",
        f"**Host**: {info.get('host', 'localhost')}:{info.get('port', 5432)}",
        f"**User**: {info.get('user', 'unknown')}",
        f"**Encoding**: {info.get('encoding', 'UTF8')}",
        f"**Timezone**: {info.get('timezone', 'unknown')}",
        f"**Connections**: {info.get('current_connections', 0)}/{info.get('max_connections', 0)}",
    ]
    
    return "\n".join(lines)


# ==================== MCP PROMPTS ====================


@mcp.prompt()
def explore_database() -> str:
    """Explore the database structure and understand the schema.
    
    Returns:
        Prompt for exploring the database
    """
    return """Please explore this PostgreSQL database and provide an overview.

Use these tools to gather information:
1. get_database_info() - Get database version and connection info
2. list_schemas() - List all schemas
3. list_tables(schema="public") - List tables in each schema
4. describe_table(table_name="...") - Get details of important tables

Then provide:
- Database overview (version, size, etc.)
- Schema organization
- Key tables and their purposes (inferred from names/structure)
- Relationships between tables (foreign keys)
- Any notable patterns or concerns"""


@mcp.prompt()
def query_builder(table_name: str) -> str:
    """Help build SQL queries for a specific table.
    
    Args:
        table_name: Table to query
        
    Returns:
        Prompt for building queries
    """
    return f"""Help me build SQL queries for the '{table_name}' table.

First, use these tools to understand the table structure:
1. describe_table(table_name="{table_name}") - Get columns and types
2. list_indexes(table_name="{table_name}") - See available indexes
3. table_stats(table_name="{table_name}") - Check table size
4. list_constraints(table_name="{table_name}") - See relationships

Then help me write efficient queries by:
- Suggesting relevant columns based on their names/types
- Using indexed columns in WHERE clauses when possible
- Adding appropriate LIMIT clauses for large tables
- Warning about potentially slow operations

Example query patterns to consider:
- Filtering by common columns
- Aggregations and GROUP BY
- JOINs with related tables"""


@mcp.prompt()
def performance_analysis(table_name: str) -> str:
    """Analyze table performance and suggest optimizations.
    
    Args:
        table_name: Table to analyze
        
    Returns:
        Prompt for performance analysis
    """
    return f"""Analyze the performance characteristics of table '{table_name}'.

Gather information using:
1. table_stats(table_name="{table_name}") - Get size and vacuum stats
2. list_indexes(table_name="{table_name}") - Review existing indexes
3. list_constraints(table_name="{table_name}") - Check constraints
4. describe_table(table_name="{table_name}") - Review column types

Then analyze:
- Table size vs expected row count (potential bloat?)
- Dead tuple percentage (needs VACUUM?)
- Index coverage for common query patterns
- Column types (appropriate for data?)
- Missing indexes on foreign key columns
- Suggestions for optimization

Provide actionable recommendations."""


@mcp.prompt()
def data_dictionary(schema: str = "public") -> str:
    """Generate a data dictionary for a schema.
    
    Args:
        schema: Schema to document
        
    Returns:
        Prompt for generating data dictionary
    """
    return f"""Generate a comprehensive data dictionary for the '{schema}' schema.

Use these tools:
1. list_tables(schema="{schema}") - Get all tables
2. For each table:
   - describe_table(table_name="...", schema="{schema}") - Get structure
   - list_indexes(table_name="...", schema="{schema}") - Get indexes
3. list_views(schema="{schema}") - Get all views
4. list_functions(schema="{schema}") - Get functions

Create documentation including:

## Tables
For each table:
- Purpose (inferred from name/columns)
- Columns with descriptions
- Primary keys
- Foreign keys and relationships
- Indexes

## Views
- Purpose and base tables

## Functions/Procedures
- Purpose and parameters

Format as markdown suitable for technical documentation."""


def main():
    """Run the MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
