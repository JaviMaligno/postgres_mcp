"""PostgreSQL client for MCP Server.

Low-level database client with connection management and query execution.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Any, Generator, Optional

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor

from postgres_mcp.settings import Settings, get_settings
from postgres_mcp.security import (
    SQLValidationError,
    safe_identifier,
    safe_schema_table,
    sanitize_limit,
    validate_query,
)

logger = logging.getLogger(__name__)


class PostgresClientError(Exception):
    """Base exception for PostgresClient errors."""
    pass


class PostgresClient:
    """PostgreSQL database client.
    
    Provides connection management and query execution with
    security validations and error handling.
    """
    
    def __init__(self, settings: Optional[Settings] = None):
        """Initialize the client.
        
        Args:
            settings: Optional settings instance. Uses get_settings() if not provided.
        """
        self.settings = settings or get_settings()
        self._connection: Optional[psycopg2.extensions.connection] = None
    
    @contextmanager
    def get_connection(self) -> Generator[psycopg2.extensions.connection, None, None]:
        """Get a database connection context manager.
        
        Yields:
            Database connection
            
        Raises:
            PostgresClientError: If connection fails
        """
        conn = None
        try:
            conn = psycopg2.connect(
                **self.settings.get_connection_dict(),
                cursor_factory=RealDictCursor,
            )
            yield conn
        except psycopg2.OperationalError as e:
            logger.error(f"Database connection failed: {e}")
            raise PostgresClientError(f"Connection failed: {e}") from e
        finally:
            if conn:
                conn.close()
    
    @contextmanager
    def get_cursor(self) -> Generator[RealDictCursor, None, None]:
        """Get a database cursor context manager.
        
        Yields:
            Database cursor with RealDictCursor factory
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                yield cursor
            finally:
                cursor.close()
    
    # ==================== QUERY EXECUTION ====================
    
    def execute_query(
        self,
        query: str,
        params: Optional[tuple] = None,
        allow_write: bool = False,
        max_rows: Optional[int] = None,
    ) -> dict[str, Any]:
        """Execute a SQL query.
        
        Args:
            query: SQL query string
            params: Optional query parameters
            allow_write: Whether to allow write operations
            max_rows: Maximum rows to return (None uses settings default)
            
        Returns:
            Dict with results, row_count, columns
        """
        # Validate query
        validated_query = validate_query(query, allow_write=allow_write)
        
        max_rows = max_rows or self.settings.max_rows
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            try:
                cursor.execute(validated_query, params)
                
                # Check if it's a SELECT query
                is_select = validated_query.strip().upper().startswith("SELECT")
                
                if is_select:
                    rows = cursor.fetchmany(max_rows + 1)
                    truncated = len(rows) > max_rows
                    if truncated:
                        rows = rows[:max_rows]
                    
                    columns = [desc[0] for desc in cursor.description] if cursor.description else []
                    
                    return {
                        "success": True,
                        "rows": [dict(row) for row in rows],
                        "row_count": len(rows),
                        "columns": columns,
                        "truncated": truncated,
                    }
                else:
                    conn.commit()
                    return {
                        "success": True,
                        "rows": [],
                        "row_count": cursor.rowcount,
                        "columns": [],
                        "message": f"{cursor.rowcount} rows affected",
                    }
            except psycopg2.Error as e:
                conn.rollback()
                raise PostgresClientError(f"Query failed: {e}") from e
            finally:
                cursor.close()
    
    def explain_query(self, query: str, analyze: bool = False) -> dict[str, Any]:
        """Get EXPLAIN plan for a query.
        
        Args:
            query: SQL query to explain
            analyze: Whether to actually run the query (EXPLAIN ANALYZE)
            
        Returns:
            Dict with execution plan
        """
        # Only allow EXPLAIN on SELECT queries
        validated_query = validate_query(query, allow_write=False)
        
        explain_cmd = "EXPLAIN (FORMAT JSON"
        if analyze:
            explain_cmd += ", ANALYZE, BUFFERS"
        explain_cmd += f") {validated_query}"
        
        with self.get_cursor() as cursor:
            cursor.execute(explain_cmd)
            result = cursor.fetchone()
            
            if result:
                plan = list(result.values())[0]
                return {
                    "success": True,
                    "plan": plan,
                }
            return {"success": False, "error": "No plan returned"}
    
    # ==================== SCHEMA OPERATIONS ====================
    
    def list_schemas(self) -> list[dict]:
        """List all schemas in the database.
        
        Returns:
            List of schema dicts with name and owner
        """
        query = """
            SELECT 
                schema_name,
                schema_owner
            FROM information_schema.schemata 
            WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
            ORDER BY schema_name
        """
        with self.get_cursor() as cursor:
            cursor.execute(query)
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== TABLE OPERATIONS ====================
    
    def list_tables(self, schema: str = "public") -> list[dict]:
        """List all tables in a schema.
        
        Args:
            schema: Schema name (default: public)
            
        Returns:
            List of table dicts
        """
        query = """
            SELECT table_name, table_type, table_schema
            FROM information_schema.tables 
            WHERE table_schema = %s
            ORDER BY table_name
        """
        with self.get_cursor() as cursor:
            cursor.execute(query, (schema,))
            return [dict(row) for row in cursor.fetchall()]
    
    def describe_table(self, table_name: str, schema: str = "public") -> dict[str, Any]:
        """Get detailed table information.
        
        Args:
            table_name: Table name
            schema: Schema name (default: public)
            
        Returns:
            Dict with columns, primary keys, foreign keys
        """
        result = {
            "schema": schema,
            "name": table_name,
            "columns": [],
            "primary_keys": [],
            "foreign_keys": [],
        }
        
        with self.get_cursor() as cursor:
            # Get columns
            cursor.execute("""
                SELECT 
                    column_name,
                    data_type,
                    is_nullable,
                    column_default,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale
                FROM information_schema.columns 
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
            """, (schema, table_name))
            result["columns"] = [dict(row) for row in cursor.fetchall()]
            
            # Get primary keys
            cursor.execute("""
                SELECT column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema = %s 
                    AND tc.table_name = %s
                    AND tc.constraint_type = 'PRIMARY KEY'
            """, (schema, table_name))
            result["primary_keys"] = [row["column_name"] for row in cursor.fetchall()]
            
            # Get foreign keys
            cursor.execute("""
                SELECT 
                    kcu.column_name,
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = tc.constraint_name
                    AND ccu.table_schema = tc.table_schema
                WHERE tc.table_schema = %s 
                    AND tc.table_name = %s
                    AND tc.constraint_type = 'FOREIGN KEY'
            """, (schema, table_name))
            result["foreign_keys"] = [
                {
                    "column": row["column_name"],
                    "references": f"{row['foreign_table_name']}.{row['foreign_column_name']}"
                }
                for row in cursor.fetchall()
            ]
        
        return result
    
    # ==================== INDEX OPERATIONS ====================
    
    def list_indexes(self, table_name: str, schema: str = "public") -> list[dict]:
        """List indexes for a table.
        
        Args:
            table_name: Table name
            schema: Schema name
            
        Returns:
            List of index dicts
        """
        query = """
            SELECT 
                i.relname AS index_name,
                t.relname AS table_name,
                ix.indisunique AS is_unique,
                ix.indisprimary AS is_primary,
                am.amname AS index_type,
                pg_get_indexdef(ix.indexrelid) AS definition,
                pg_relation_size(i.oid) AS size_bytes
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_am am ON am.oid = i.relam
            WHERE n.nspname = %s
                AND t.relname = %s
            ORDER BY i.relname
        """
        with self.get_cursor() as cursor:
            cursor.execute(query, (schema, table_name))
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== CONSTRAINT OPERATIONS ====================
    
    def list_constraints(self, table_name: str, schema: str = "public") -> list[dict]:
        """List constraints for a table.
        
        Args:
            table_name: Table name
            schema: Schema name
            
        Returns:
            List of constraint dicts
        """
        query = """
            SELECT 
                tc.constraint_name,
                tc.constraint_type,
                tc.table_name,
                kcu.column_name,
                ccu.table_name AS references_table,
                ccu.column_name AS references_column,
                cc.check_clause
            FROM information_schema.table_constraints tc
            LEFT JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
            LEFT JOIN information_schema.constraint_column_usage ccu
                ON tc.constraint_name = ccu.constraint_name
                AND tc.table_schema = ccu.table_schema
                AND tc.constraint_type = 'FOREIGN KEY'
            LEFT JOIN information_schema.check_constraints cc
                ON tc.constraint_name = cc.constraint_name
                AND tc.table_schema = cc.constraint_schema
            WHERE tc.table_schema = %s
                AND tc.table_name = %s
            ORDER BY tc.constraint_type, tc.constraint_name
        """
        with self.get_cursor() as cursor:
            cursor.execute(query, (schema, table_name))
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== VIEW OPERATIONS ====================
    
    def list_views(self, schema: str = "public") -> list[dict]:
        """List views in a schema.
        
        Args:
            schema: Schema name
            
        Returns:
            List of view dicts
        """
        query = """
            SELECT table_name, table_schema
            FROM information_schema.views 
            WHERE table_schema = %s
            ORDER BY table_name
        """
        with self.get_cursor() as cursor:
            cursor.execute(query, (schema,))
            return [dict(row) for row in cursor.fetchall()]
    
    def describe_view(self, view_name: str, schema: str = "public") -> dict[str, Any]:
        """Get view definition and columns.
        
        Args:
            view_name: View name
            schema: Schema name
            
        Returns:
            Dict with view definition and columns
        """
        result = {
            "name": view_name,
            "schema": schema,
            "definition": "",
            "columns": [],
        }
        
        with self.get_cursor() as cursor:
            # Get view definition
            cursor.execute("""
                SELECT view_definition
                FROM information_schema.views
                WHERE table_schema = %s AND table_name = %s
            """, (schema, view_name))
            row = cursor.fetchone()
            if row:
                result["definition"] = row["view_definition"]
            
            # Get columns
            cursor.execute("""
                SELECT 
                    column_name,
                    data_type,
                    is_nullable
                FROM information_schema.columns 
                WHERE table_schema = %s AND table_name = %s
                ORDER BY ordinal_position
            """, (schema, view_name))
            result["columns"] = [dict(row) for row in cursor.fetchall()]
        
        return result
    
    # ==================== FUNCTION OPERATIONS ====================
    
    def list_functions(self, schema: str = "public") -> list[dict]:
        """List functions and procedures in a schema.
        
        Args:
            schema: Schema name
            
        Returns:
            List of function dicts
        """
        query = """
            SELECT 
                p.proname AS routine_name,
                n.nspname AS routine_schema,
                pg_get_function_result(p.oid) AS return_type,
                pg_get_function_arguments(p.oid) AS argument_types,
                CASE p.prokind
                    WHEN 'f' THEN 'function'
                    WHEN 'p' THEN 'procedure'
                    WHEN 'a' THEN 'aggregate'
                    WHEN 'w' THEN 'window'
                    ELSE 'unknown'
                END AS routine_type
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = %s
                AND p.proname NOT LIKE 'pg_%'
            ORDER BY p.proname
        """
        with self.get_cursor() as cursor:
            cursor.execute(query, (schema,))
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== STATISTICS ====================
    
    def get_table_stats(self, table_name: str, schema: str = "public") -> dict[str, Any]:
        """Get table statistics.
        
        Args:
            table_name: Table name
            schema: Schema name
            
        Returns:
            Dict with table statistics
        """
        query = """
            SELECT 
                schemaname,
                relname AS table_name,
                n_live_tup AS row_count,
                n_dead_tup AS dead_tuples,
                last_vacuum,
                last_autovacuum,
                last_analyze,
                last_autoanalyze,
                pg_total_relation_size(schemaname || '.' || relname) AS total_size,
                pg_table_size(schemaname || '.' || relname) AS table_size,
                pg_indexes_size(schemaname || '.' || relname) AS index_size
            FROM pg_stat_user_tables
            WHERE schemaname = %s AND relname = %s
        """
        with self.get_cursor() as cursor:
            cursor.execute(query, (schema, table_name))
            row = cursor.fetchone()
            if row:
                return dict(row)
            return {}
    
    # ==================== DATABASE INFO ====================
    
    def get_database_info(self) -> dict[str, Any]:
        """Get database and connection information.
        
        Returns:
            Dict with database info
        """
        with self.get_cursor() as cursor:
            cursor.execute("SELECT version()")
            version_row = cursor.fetchone()
            
            cursor.execute("""
                SELECT 
                    current_database() AS database,
                    current_user AS user,
                    inet_server_addr() AS host,
                    inet_server_port() AS port,
                    pg_encoding_to_char(encoding) AS encoding,
                    current_setting('TimeZone') AS timezone,
                    current_setting('max_connections')::int AS max_connections
                FROM pg_database
                WHERE datname = current_database()
            """)
            info_row = cursor.fetchone()
            
            cursor.execute("SELECT count(*) AS current_connections FROM pg_stat_activity")
            conn_row = cursor.fetchone()
            
            result = dict(info_row) if info_row else {}
            result["version"] = version_row["version"] if version_row else ""
            result["current_connections"] = conn_row["current_connections"] if conn_row else 0
            
            return result
    
    # ==================== COLUMN SEARCH ====================
    
    def search_columns(self, search_term: str, schema: Optional[str] = None) -> list[dict]:
        """Search for columns by name.
        
        Args:
            search_term: Column name pattern (supports LIKE wildcards)
            schema: Optional schema filter
            
        Returns:
            List of matching columns with table info
        """
        # Sanitize search term for LIKE pattern
        search_pattern = f"%{search_term}%"
        
        query = """
            SELECT 
                table_schema,
                table_name,
                column_name,
                data_type,
                is_nullable
            FROM information_schema.columns
            WHERE column_name ILIKE %s
        """
        params = [search_pattern]
        
        if schema:
            query += " AND table_schema = %s"
            params.append(schema)
        
        query += """
            AND table_schema NOT IN ('information_schema', 'pg_catalog')
            ORDER BY table_schema, table_name, column_name
            LIMIT 100
        """
        
        with self.get_cursor() as cursor:
            cursor.execute(query, params)
            return [dict(row) for row in cursor.fetchall()]


# Singleton instance
_client: Optional[PostgresClient] = None


def get_client() -> PostgresClient:
    """Get the singleton PostgresClient instance.
    
    Returns:
        PostgresClient instance
    """
    global _client
    if _client is None:
        _client = PostgresClient()
    return _client


def reset_client() -> None:
    """Reset the singleton client.
    
    Useful for testing when settings change.
    """
    global _client
    _client = None

