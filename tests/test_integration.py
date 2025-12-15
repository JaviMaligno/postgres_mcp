"""
Integration tests for postgresql-mcp.

These tests require a running PostgreSQL instance.
Run with: docker-compose up -d && uv run pytest tests/test_integration.py -v

Skip these tests if no database is available by running:
uv run pytest tests/ -v --ignore=tests/test_integration.py
"""

import os
import pytest

# Skip all tests in this module if POSTGRES_PASSWORD is not set
pytestmark = pytest.mark.skipif(
    not os.environ.get("POSTGRES_PASSWORD"),
    reason="Integration tests require POSTGRES_PASSWORD environment variable"
)


class TestDatabaseConnection:
    """Test basic database connectivity."""

    def test_can_connect(self):
        """Verify we can connect to the database."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        # get_connection() is a context manager
        with client.get_connection() as conn:
            assert conn is not None
            assert not conn.closed

    def test_list_schemas(self):
        """Test listing schemas."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        schemas = client.list_schemas()
        
        assert isinstance(schemas, list)
        schema_names = [s["schema_name"] for s in schemas]
        assert "public" in schema_names

    def test_list_tables(self):
        """Test listing tables in public schema."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        tables = client.list_tables("public")
        
        assert isinstance(tables, list)
        # Should have our sample tables
        table_names = [t["table_name"] for t in tables]
        assert "customers" in table_names
        assert "products" in table_names
        assert "orders" in table_names

    def test_describe_table(self):
        """Test describing a table."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        result = client.describe_table("customers", "public")
        
        assert isinstance(result, dict)
        assert "columns" in result
        assert len(result["columns"]) > 0
        
        column_names = [c["column_name"] for c in result["columns"]]
        assert "id" in column_names
        assert "email" in column_names
        assert "name" in column_names
        
        # Check primary keys
        assert "id" in result["primary_keys"]

    def test_execute_query_select(self):
        """Test executing a SELECT query."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        result = client.execute_query("SELECT COUNT(*) as count FROM customers")
        
        assert result["success"] is True
        assert isinstance(result["rows"], list)
        assert len(result["rows"]) == 1
        assert result["rows"][0]["count"] >= 0

    def test_execute_query_with_limit(self):
        """Test query respects max_rows parameter."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        result = client.execute_query("SELECT * FROM products", max_rows=2)
        
        assert result["success"] is True
        assert isinstance(result["rows"], list)
        assert len(result["rows"]) <= 2

    def test_get_table_stats(self):
        """Test getting table statistics."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        stats = client.get_table_stats("customers", "public")
        
        assert isinstance(stats, dict)
        assert "table_name" in stats
        assert "row_count" in stats
        assert "total_size" in stats

    def test_list_indexes(self):
        """Test listing indexes."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        indexes = client.list_indexes("orders", "public")
        
        assert isinstance(indexes, list)
        # orders table should have indexes
        index_names = [i["index_name"] for i in indexes]
        assert "orders_pkey" in index_names

    def test_list_views(self):
        """Test listing views."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        views = client.list_views("public")
        
        assert isinstance(views, list)
        view_names = [v["table_name"] for v in views]
        assert "customer_order_summary" in view_names

    def test_explain_query(self):
        """Test EXPLAIN."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        result = client.explain_query("SELECT * FROM customers WHERE id = 1")
        
        assert result["success"] is True
        assert "plan" in result

    def test_search_columns(self):
        """Test searching for columns by name pattern."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        columns = client.search_columns("email")
        
        assert isinstance(columns, list)
        assert len(columns) > 0
        # Should find email column in customers table
        found = any(
            c["table_name"] == "customers" and c["column_name"] == "email"
            for c in columns
        )
        assert found

    def test_get_database_info(self):
        """Test getting database information."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        info = client.get_database_info()
        
        assert isinstance(info, dict)
        assert "database" in info
        assert "version" in info

    def test_list_constraints(self):
        """Test listing constraints."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        constraints = client.list_constraints("orders", "public")
        
        assert isinstance(constraints, list)
        # orders table should have foreign key constraints
        constraint_types = [c["constraint_type"] for c in constraints]
        assert "PRIMARY KEY" in constraint_types
        assert "FOREIGN KEY" in constraint_types


class TestSecurityIntegration:
    """Test security features with real database."""

    def test_write_blocked_by_default(self):
        """Verify write operations are blocked in execute_query()."""
        from postgres_mcp.postgres_client import PostgresClient
        from postgres_mcp.security import SQLValidationError
        
        client = PostgresClient()
        
        with pytest.raises(SQLValidationError, match="not allowed"):
            client.execute_query("INSERT INTO customers (email, name) VALUES ('test@test.com', 'Test')")

    def test_drop_blocked(self):
        """Verify DROP is blocked."""
        from postgres_mcp.postgres_client import PostgresClient
        from postgres_mcp.security import SQLValidationError
        
        client = PostgresClient()
        
        with pytest.raises(SQLValidationError, match="not allowed"):
            client.execute_query("DROP TABLE customers")

    def test_sql_injection_blocked(self):
        """Test SQL injection attempts are blocked."""
        from postgres_mcp.postgres_client import PostgresClient
        from postgres_mcp.security import SQLValidationError
        
        client = PostgresClient()
        
        # Multiple statements blocked
        with pytest.raises(SQLValidationError, match="[Mm]ultiple"):
            client.execute_query("SELECT 1; DROP TABLE customers;")
        
        # DROP keyword blocked (regardless of multiple statements)
        with pytest.raises(SQLValidationError, match="not allowed"):
            client.execute_query("DROP TABLE customers")

    def test_write_allowed_when_enabled(self):
        """Verify write operations work with allow_write=True."""
        from postgres_mcp.postgres_client import PostgresClient
        
        client = PostgresClient()
        
        # This should not raise when allow_write is True
        # We'll test with a harmless INSERT that we can rollback
        result = client.execute_query(
            "INSERT INTO customers (email, name) VALUES ('integration_test@test.com', 'Integration Test')",
            allow_write=True
        )
        assert result["success"] is True
        
        # Clean up
        client.execute_query(
            "DELETE FROM customers WHERE email = 'integration_test@test.com'",
            allow_write=True
        )
