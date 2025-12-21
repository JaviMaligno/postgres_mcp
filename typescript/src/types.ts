/**
 * Type definitions for PostgreSQL MCP Server
 */

// ==================== CONFIGURATION ====================

export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslmode?: string;
}

// ==================== DATABASE TYPES ====================

export interface SchemaInfo {
  schema_name: string;
  schema_owner: string;
}

export interface TableInfo {
  table_name: string;
  table_type: string;
  table_schema: string;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

export interface ForeignKeyInfo {
  column: string;
  references: string;
}

export interface TableDescription {
  schema: string;
  name: string;
  columns: ColumnInfo[];
  primary_keys: string[];
  foreign_keys: ForeignKeyInfo[];
}

export interface IndexInfo {
  index_name: string;
  table_name: string;
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
  definition: string;
  size_bytes: number;
}

export interface ConstraintInfo {
  constraint_name: string;
  constraint_type: string;
  table_name: string;
  column_name: string | null;
  references_table: string | null;
  references_column: string | null;
  check_clause: string | null;
}

export interface ViewInfo {
  table_name: string;
  table_schema: string;
}

export interface ViewDescription {
  name: string;
  schema: string;
  definition: string;
  columns: {
    column_name: string;
    data_type: string;
    is_nullable: string;
  }[];
}

export interface FunctionInfo {
  routine_name: string;
  routine_schema: string;
  return_type: string;
  argument_types: string;
  routine_type: string;
}

export interface TableStats {
  schemaname: string;
  table_name: string;
  row_count: number;
  dead_tuples: number;
  last_vacuum: Date | null;
  last_autovacuum: Date | null;
  last_analyze: Date | null;
  last_autoanalyze: Date | null;
  total_size: number;
  table_size: number;
  index_size: number;
}

export interface DatabaseInfo {
  database: string;
  user: string;
  host: string | null;
  port: number | null;
  encoding: string;
  timezone: string;
  max_connections: number;
  version: string;
  current_connections: number;
}

export interface ColumnSearchResult {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
}

// ==================== QUERY RESULTS ====================

export interface QueryResult {
  success: boolean;
  rows: Record<string, unknown>[];
  row_count: number;
  columns: string[];
  truncated?: boolean;
  message?: string;
}

export interface ExplainResult {
  success: boolean;
  plan?: unknown;
  error?: string;
}

