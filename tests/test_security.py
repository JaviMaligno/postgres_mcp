"""Tests for postgres_mcp.security module."""

import pytest

from postgres_mcp.security import (
    SQLValidationError,
    validate_query,
    validate_identifier,
    sanitize_limit,
    MAX_QUERY_LENGTH,
)


class TestValidateQuery:
    """Tests for validate_query function."""
    
    def test_valid_select_query(self):
        """Valid SELECT query should pass."""
        query = "SELECT * FROM users WHERE id = 1"
        result = validate_query(query)
        assert result == query
    
    def test_valid_select_with_trailing_semicolon(self):
        """SELECT with trailing semicolon should pass."""
        query = "SELECT * FROM users;"
        result = validate_query(query)
        assert result == query
    
    def test_empty_query_raises(self):
        """Empty query should raise SQLValidationError."""
        with pytest.raises(SQLValidationError, match="cannot be empty"):
            validate_query("")
    
    def test_whitespace_only_raises(self):
        """Whitespace-only query should raise SQLValidationError."""
        with pytest.raises(SQLValidationError, match="cannot be empty"):
            validate_query("   \n\t  ")
    
    def test_write_operation_blocked_by_default(self):
        """Write operations should be blocked by default."""
        write_queries = [
            "INSERT INTO users VALUES (1, 'test')",
            "UPDATE users SET name = 'test'",
            "DELETE FROM users WHERE id = 1",
            "DROP TABLE users",
            "CREATE TABLE test (id INT)",
            "ALTER TABLE users ADD COLUMN age INT",
            "TRUNCATE TABLE users",
        ]
        for query in write_queries:
            with pytest.raises(SQLValidationError, match="not allowed in read-only mode"):
                validate_query(query, allow_write=False)
    
    def test_write_operation_allowed_when_enabled(self):
        """Write operations should pass when allow_write=True."""
        query = "INSERT INTO users VALUES (1, 'test')"
        result = validate_query(query, allow_write=True)
        assert result == query
    
    def test_multiple_statements_blocked(self):
        """Multiple statements should be blocked."""
        query = "SELECT * FROM users; DROP TABLE users"
        with pytest.raises(SQLValidationError, match="Multiple SQL statements"):
            validate_query(query)
    
    def test_dangerous_operations_always_blocked(self):
        """Dangerous operations should always be blocked."""
        dangerous_queries = [
            "DROP DATABASE mydb",
            "DROP SCHEMA public CASCADE",
            "CREATE ROLE admin",
            "ALTER ROLE admin SUPERUSER",
        ]
        for query in dangerous_queries:
            with pytest.raises(SQLValidationError, match="not allowed"):
                validate_query(query, allow_write=True)
    
    def test_sql_comments_blocked(self):
        """SQL comments should be blocked."""
        queries_with_comments = [
            "SELECT * FROM users -- comment",
            "SELECT * FROM users /* comment */",
        ]
        for query in queries_with_comments:
            with pytest.raises(SQLValidationError, match="comments are not allowed"):
                validate_query(query)
    
    def test_query_length_limit(self):
        """Query exceeding max length should be blocked."""
        long_query = "SELECT " + "x" * (MAX_QUERY_LENGTH + 1)
        with pytest.raises(SQLValidationError, match="exceeds maximum length"):
            validate_query(long_query)
    
    def test_keyword_in_column_name_allowed(self):
        """Keywords appearing in column names should be allowed."""
        # UPDATED_AT contains "UPDATE" but should be allowed
        query = "SELECT updated_at FROM users"
        result = validate_query(query)
        assert result == query
    
    def test_case_insensitive_keyword_detection(self):
        """Write keywords should be detected case-insensitively."""
        with pytest.raises(SQLValidationError, match="not allowed"):
            validate_query("insert into users values (1)")
        with pytest.raises(SQLValidationError, match="not allowed"):
            validate_query("INSERT INTO users values (1)")


class TestValidateIdentifier:
    """Tests for validate_identifier function."""
    
    def test_valid_simple_identifier(self):
        """Simple identifiers should pass."""
        assert validate_identifier("users") == "users"
        assert validate_identifier("user_table") == "user_table"
        assert validate_identifier("_private") == "_private"
        assert validate_identifier("Table1") == "Table1"
    
    def test_valid_qualified_identifier(self):
        """Schema.table identifiers should pass."""
        assert validate_identifier("public.users") == "public.users"
        assert validate_identifier("my_schema.my_table") == "my_schema.my_table"
    
    def test_empty_identifier_raises(self):
        """Empty identifier should raise SQLValidationError."""
        with pytest.raises(SQLValidationError, match="cannot be empty"):
            validate_identifier("")
    
    def test_invalid_characters_raises(self):
        """Invalid characters should raise SQLValidationError."""
        invalid_identifiers = [
            "table-name",  # hyphen not allowed
            "table name",  # space not allowed
            "123table",    # can't start with number
            "table;drop",  # semicolon not allowed
            "table'name",  # quote not allowed
            'table"name',  # double quote not allowed
        ]
        for identifier in invalid_identifiers:
            with pytest.raises(SQLValidationError, match="Invalid identifier"):
                validate_identifier(identifier)
    
    def test_sql_injection_attempt_blocked(self):
        """SQL injection attempts should be blocked."""
        injection_attempts = [
            "'; DROP TABLE users; --",
            "users; DELETE FROM users",
            "users OR 1=1",
        ]
        for attempt in injection_attempts:
            with pytest.raises(SQLValidationError, match="Invalid identifier"):
                validate_identifier(attempt)
    
    def test_max_length_enforced(self):
        """Identifier exceeding max length should be blocked."""
        long_identifier = "a" * 64
        with pytest.raises(SQLValidationError, match="exceeds maximum length"):
            validate_identifier(long_identifier, max_length=63)


class TestSanitizeLimit:
    """Tests for sanitize_limit function."""
    
    def test_valid_limit(self):
        """Valid limits should pass through."""
        assert sanitize_limit(10) == 10
        assert sanitize_limit(100) == 100
        assert sanitize_limit(1000) == 1000
    
    def test_limit_clamped_to_max(self):
        """Limit exceeding max should be clamped."""
        assert sanitize_limit(2000, max_limit=1000) == 1000
        assert sanitize_limit(999999, max_limit=100) == 100
    
    def test_invalid_limit_uses_default(self):
        """Invalid limits should use default."""
        assert sanitize_limit(0, default=100) == 100
        assert sanitize_limit(-1, default=100) == 100
    
    def test_non_integer_uses_default(self):
        """Non-integer should use default."""
        assert sanitize_limit("10", default=50) == 50  # type: ignore
        assert sanitize_limit(None, default=50) == 50  # type: ignore
