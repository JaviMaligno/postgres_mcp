"""Tests for postgres_mcp.utils module."""

import pytest

from postgres_mcp.utils import (
    truncate_string,
    format_bytes,
    format_count,
    not_found_response,
)


class TestTruncateString:
    """Tests for truncate_string function."""
    
    def test_short_string_unchanged(self):
        """Short strings should be unchanged."""
        assert truncate_string("Hello", 10) == "Hello"
    
    def test_long_string_truncated(self):
        """Long strings should be truncated with ellipsis."""
        result = truncate_string("Hello World", 8)
        assert result == "Hello..."
        assert len(result) == 8
    
    def test_none_returns_empty(self):
        """None should return empty string."""
        assert truncate_string(None) == ""
    
    def test_empty_string(self):
        """Empty string should return empty string."""
        assert truncate_string("") == ""


class TestFormatBytes:
    """Tests for format_bytes function."""
    
    def test_bytes(self):
        """Small values should show bytes."""
        assert format_bytes(100) == "100.0 B"
    
    def test_kilobytes(self):
        """KB values should be formatted."""
        assert format_bytes(1024) == "1.0 KB"
        assert format_bytes(1536) == "1.5 KB"
    
    def test_megabytes(self):
        """MB values should be formatted."""
        assert format_bytes(1048576) == "1.0 MB"
    
    def test_gigabytes(self):
        """GB values should be formatted."""
        assert format_bytes(1073741824) == "1.0 GB"
    
    def test_none_returns_unknown(self):
        """None should return 'unknown'."""
        assert format_bytes(None) == "unknown"


class TestFormatCount:
    """Tests for format_count function."""
    
    def test_small_numbers(self):
        """Small numbers should be unchanged."""
        assert format_count(100) == "100"
        assert format_count(999) == "999"
    
    def test_thousands(self):
        """Thousands should show K suffix."""
        assert format_count(1000) == "1.0K"
        assert format_count(1500) == "1.5K"
    
    def test_millions(self):
        """Millions should show M suffix."""
        assert format_count(1000000) == "1.0M"
        assert format_count(1500000) == "1.5M"
    
    def test_none_returns_unknown(self):
        """None should return 'unknown'."""
        assert format_count(None) == "unknown"


class TestNotFoundResponse:
    """Tests for not_found_response function."""
    
    def test_format(self):
        """Response should have correct format."""
        result = not_found_response("Table", "users")
        assert result == {"error": "Table 'users' not found"}
    
    def test_different_resources(self):
        """Should work with different resource types."""
        assert not_found_response("Schema", "myschema") == {"error": "Schema 'myschema' not found"}
        assert not_found_response("View", "myview") == {"error": "View 'myview' not found"}
