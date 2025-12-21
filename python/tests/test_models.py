"""Tests for postgres_mcp.models module."""

import pytest

from postgres_mcp.models import (
    SchemaSummary,
    TableSummary,
    ColumnInfo,
    IndexInfo,
    ConstraintInfo,
    ViewSummary,
    FunctionSummary,
    TableStats,
)


class TestSchemaSummary:
    """Tests for SchemaSummary model."""
    
    def test_from_row(self):
        """SchemaSummary should parse row correctly."""
        row = {"schema_name": "public", "schema_owner": "postgres"}
        schema = SchemaSummary.from_row(row)
        assert schema.name == "public"
        assert schema.owner == "postgres"
    
    def test_from_row_missing_fields(self):
        """SchemaSummary should handle missing fields."""
        row = {}
        schema = SchemaSummary.from_row(row)
        assert schema.name == ""
        assert schema.owner is None


class TestTableSummary:
    """Tests for TableSummary model."""
    
    def test_from_row(self):
        """TableSummary should parse row correctly."""
        row = {
            "table_name": "users",
            "table_type": "BASE TABLE",
            "table_schema": "public",
        }
        table = TableSummary.from_row(row)
        assert table.name == "users"
        assert table.type == "BASE TABLE"
        assert table.schema_name == "public"
    
    def test_defaults(self):
        """TableSummary should have sensible defaults."""
        row = {"table_name": "test"}
        table = TableSummary.from_row(row)
        assert table.type == "BASE TABLE"
        assert table.schema_name == "public"


class TestColumnInfo:
    """Tests for ColumnInfo model."""
    
    def test_from_row(self):
        """ColumnInfo should parse row correctly."""
        row = {
            "column_name": "id",
            "data_type": "integer",
            "is_nullable": "NO",
            "column_default": "nextval('users_id_seq'::regclass)",
            "character_maximum_length": None,
            "numeric_precision": 32,
            "numeric_scale": 0,
        }
        col = ColumnInfo.from_row(row, primary_keys=["id"])
        assert col.name == "id"
        assert col.type == "integer"
        assert col.nullable is False
        assert col.is_primary_key is True
        assert col.precision == 32
    
    def test_nullable_mapping(self):
        """ColumnInfo should correctly map is_nullable."""
        row_yes = {"column_name": "test", "data_type": "text", "is_nullable": "YES"}
        row_no = {"column_name": "test", "data_type": "text", "is_nullable": "NO"}
        
        col_yes = ColumnInfo.from_row(row_yes)
        col_no = ColumnInfo.from_row(row_no)
        
        assert col_yes.nullable is True
        assert col_no.nullable is False


class TestIndexInfo:
    """Tests for IndexInfo model."""
    
    def test_from_row(self):
        """IndexInfo should parse row correctly."""
        row = {
            "indexname": "users_pkey",
            "tablename": "users",
            "is_unique": True,
            "is_primary": True,
            "index_type": "btree",
            "size_bytes": 16384,
        }
        idx = IndexInfo.from_row(row)
        assert idx.name == "users_pkey"
        assert idx.table_name == "users"
        assert idx.is_unique is True
        assert idx.is_primary is True
    
    def test_columns_parsing(self):
        """IndexInfo should parse columns string."""
        row = {
            "indexname": "test_idx",
            "tablename": "test",
            "columns": "col1, col2, col3",
        }
        idx = IndexInfo.from_row(row)
        assert idx.columns == ["col1", "col2", "col3"]


class TestConstraintInfo:
    """Tests for ConstraintInfo model."""
    
    def test_from_row(self):
        """ConstraintInfo should parse row correctly."""
        row = {
            "constraint_name": "users_pkey",
            "constraint_type": "PRIMARY KEY",
            "table_name": "users",
            "columns": "id",
        }
        constraint = ConstraintInfo.from_row(row)
        assert constraint.name == "users_pkey"
        assert constraint.type == "PRIMARY KEY"
        assert constraint.columns == ["id"]


class TestViewSummary:
    """Tests for ViewSummary model."""
    
    def test_from_row(self):
        """ViewSummary should parse row correctly."""
        row = {"table_name": "user_view", "table_schema": "public"}
        view = ViewSummary.from_row(row)
        assert view.name == "user_view"
        assert view.schema_name == "public"


class TestFunctionSummary:
    """Tests for FunctionSummary model."""
    
    def test_from_row(self):
        """FunctionSummary should parse row correctly."""
        row = {
            "routine_name": "my_function",
            "routine_schema": "public",
            "data_type": "integer",
            "argument_types": "text, integer",
            "routine_type": "function",
        }
        func = FunctionSummary.from_row(row)
        assert func.name == "my_function"
        assert func.schema_name == "public"
        assert func.return_type == "integer"
        assert func.argument_types == "text, integer"
        assert func.func_type == "function"


class TestTableStats:
    """Tests for TableStats model."""
    
    def test_from_row(self):
        """TableStats should parse row correctly."""
        row = {
            "schemaname": "public",
            "relname": "users",
            "n_live_tup": 10000,
            "n_dead_tup": 100,
            "total_size": 1048576,
            "table_size": 819200,
            "index_size": 229376,
            "last_vacuum": "2024-01-15 10:00:00",
            "last_analyze": "2024-01-15 10:30:00",
        }
        stats = TableStats.from_row(row)
        assert stats.schema_name == "public"
        assert stats.table_name == "users"
        assert stats.row_count == 10000
        assert stats.dead_tuples == 100
        assert stats.total_size == 1048576
