"""Pydantic models for PostgreSQL MCP Server responses.

These models handle transformation from database results to clean,
typed dictionaries for MCP tool responses.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, field_validator


# ==================== SCHEMAS ====================


class SchemaSummary(BaseModel):
    """Schema info for list responses."""
    
    name: str
    owner: Optional[str] = None
    
    @classmethod
    def from_row(cls, row: dict) -> "SchemaSummary":
        return cls(
            name=row.get("schema_name", ""),
            owner=row.get("schema_owner"),
        )


# ==================== TABLES ====================


class TableSummary(BaseModel):
    """Table info for list responses."""
    
    model_config = {"populate_by_name": True}
    
    name: str
    type: str = "BASE TABLE"
    schema_name: str = "public"
    
    @classmethod
    def from_row(cls, row: dict) -> "TableSummary":
        return cls(
            name=row.get("table_name", ""),
            type=row.get("table_type", "BASE TABLE"),
            schema_name=row.get("table_schema", "public"),
        )


class ColumnInfo(BaseModel):
    """Column information."""
    
    name: str
    type: str
    nullable: bool = True
    default: Optional[str] = None
    is_primary_key: bool = False
    max_length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    
    @classmethod
    def from_row(cls, row: dict, primary_keys: list[str] = None) -> "ColumnInfo":
        primary_keys = primary_keys or []
        return cls(
            name=row.get("column_name", ""),
            type=row.get("data_type", ""),
            nullable=row.get("is_nullable", "YES") == "YES",
            default=row.get("column_default"),
            is_primary_key=row.get("column_name", "") in primary_keys,
            max_length=row.get("character_maximum_length"),
            precision=row.get("numeric_precision"),
            scale=row.get("numeric_scale"),
        )


class TableDetail(BaseModel):
    """Detailed table information."""
    
    schema_name: str
    name: str
    columns: list[ColumnInfo] = []
    primary_keys: list[str] = []
    foreign_keys: list[dict] = []
    row_count: Optional[int] = None
    size_bytes: Optional[int] = None


# ==================== INDEXES ====================


class IndexInfo(BaseModel):
    """Index information."""
    
    name: str
    table_name: str
    columns: list[str] = []
    is_unique: bool = False
    is_primary: bool = False
    index_type: str = "btree"
    size_bytes: Optional[int] = None
    
    @classmethod
    def from_row(cls, row: dict) -> "IndexInfo":
        columns = row.get("columns", "")
        if isinstance(columns, str):
            columns = [c.strip() for c in columns.split(",") if c.strip()]
        return cls(
            name=row.get("indexname", row.get("index_name", "")),
            table_name=row.get("tablename", row.get("table_name", "")),
            columns=columns,
            is_unique=row.get("is_unique", False),
            is_primary=row.get("is_primary", False),
            index_type=row.get("index_type", "btree"),
            size_bytes=row.get("size_bytes"),
        )


# ==================== CONSTRAINTS ====================


class ConstraintInfo(BaseModel):
    """Constraint information."""
    
    name: str
    type: str  # PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK
    table_name: str
    columns: list[str] = []
    definition: Optional[str] = None
    references_table: Optional[str] = None
    references_columns: list[str] = []
    
    @classmethod
    def from_row(cls, row: dict) -> "ConstraintInfo":
        columns = row.get("columns", [])
        if isinstance(columns, str):
            columns = [c.strip() for c in columns.split(",") if c.strip()]
        ref_columns = row.get("references_columns", [])
        if isinstance(ref_columns, str):
            ref_columns = [c.strip() for c in ref_columns.split(",") if c.strip()]
        return cls(
            name=row.get("constraint_name", ""),
            type=row.get("constraint_type", ""),
            table_name=row.get("table_name", ""),
            columns=columns,
            definition=row.get("check_clause"),
            references_table=row.get("references_table"),
            references_columns=ref_columns,
        )


# ==================== VIEWS ====================


class ViewSummary(BaseModel):
    """View info for list responses."""
    
    name: str
    schema_name: str = "public"
    
    @classmethod
    def from_row(cls, row: dict) -> "ViewSummary":
        return cls(
            name=row.get("table_name", ""),
            schema_name=row.get("table_schema", "public"),
        )


class ViewDetail(BaseModel):
    """Detailed view information."""
    
    name: str
    schema_name: str = "public"
    definition: str = ""
    columns: list[ColumnInfo] = []


# ==================== FUNCTIONS ====================


class FunctionSummary(BaseModel):
    """Function/procedure info."""
    
    name: str
    schema_name: str = "public"
    return_type: Optional[str] = None
    argument_types: str = ""
    func_type: str = "function"  # function, procedure, aggregate
    
    @classmethod
    def from_row(cls, row: dict) -> "FunctionSummary":
        return cls(
            name=row.get("routine_name", row.get("proname", "")),
            schema_name=row.get("routine_schema", row.get("nspname", "public")),
            return_type=row.get("data_type", row.get("return_type")),
            argument_types=row.get("argument_types", ""),
            func_type=row.get("routine_type", "function").lower(),
        )


# ==================== STATISTICS ====================


class TableStats(BaseModel):
    """Table statistics."""
    
    schema_name: str
    table_name: str
    row_count: Optional[int] = None
    total_size: Optional[int] = None
    table_size: Optional[int] = None
    index_size: Optional[int] = None
    toast_size: Optional[int] = None
    dead_tuples: Optional[int] = None
    last_vacuum: Optional[str] = None
    last_analyze: Optional[str] = None
    
    @classmethod
    def from_row(cls, row: dict) -> "TableStats":
        return cls(
            schema_name=row.get("schemaname", "public"),
            table_name=row.get("relname", row.get("table_name", "")),
            row_count=row.get("n_live_tup", row.get("row_count")),
            total_size=row.get("total_size"),
            table_size=row.get("table_size"),
            index_size=row.get("index_size"),
            toast_size=row.get("toast_size"),
            dead_tuples=row.get("n_dead_tup"),
            last_vacuum=str(row.get("last_vacuum")) if row.get("last_vacuum") else None,
            last_analyze=str(row.get("last_analyze")) if row.get("last_analyze") else None,
        )


# ==================== DATABASE INFO ====================


class DatabaseInfo(BaseModel):
    """Database connection and version info."""
    
    version: str
    server_version: str
    database: str
    user: str
    host: str
    port: int
    encoding: str = "UTF8"
    timezone: Optional[str] = None
    max_connections: Optional[int] = None
    current_connections: Optional[int] = None


# ==================== QUERY RESULTS ====================


class QueryResult(BaseModel):
    """Query execution result."""
    
    success: bool = True
    rows: list[dict] = []
    row_count: int = 0
    columns: list[str] = []
    execution_time_ms: Optional[float] = None
    truncated: bool = False
    message: Optional[str] = None


class ExplainResult(BaseModel):
    """EXPLAIN query result."""
    
    plan: list[dict] = []
    planning_time_ms: Optional[float] = None
    execution_time_ms: Optional[float] = None
    total_cost: Optional[float] = None
    rows_estimate: Optional[int] = None

