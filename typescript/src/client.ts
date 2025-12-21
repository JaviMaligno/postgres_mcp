/**
 * PostgreSQL client for MCP Server.
 * 
 * Low-level database client with connection management and query execution.
 */

import pg from 'pg';
import { getConnectionConfig, getSettings } from './settings.js';
import { validateQuery, validateIdentifier, escapeLikePattern, SQLValidationError } from './security.js';
import type {
  SchemaInfo,
  TableInfo,
  ColumnInfo,
  TableDescription,
  IndexInfo,
  ConstraintInfo,
  ViewInfo,
  ViewDescription,
  FunctionInfo,
  TableStats,
  DatabaseInfo,
  ColumnSearchResult,
  QueryResult,
  ExplainResult,
} from './types.js';

const { Pool } = pg;

/**
 * Error class for PostgreSQL client errors
 */
export class PostgresClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostgresClientError';
  }
}

/**
 * PostgreSQL database client
 */
export class PostgresClient {
  private pool: pg.Pool;

  constructor() {
    const config = getConnectionConfig();
    this.pool = new Pool(config);
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  // ==================== QUERY EXECUTION ====================

  /**
   * Execute a SQL query
   */
  async executeQuery(
    query: string,
    params?: unknown[],
    options: { allowWrite?: boolean; maxRows?: number } = {}
  ): Promise<QueryResult> {
    const settings = getSettings();
    const { allowWrite = false, maxRows = settings.maxRows } = options;

    // Validate query
    const validatedQuery = validateQuery(query, allowWrite);

    const client = await this.pool.connect();
    try {
      const result = await client.query(validatedQuery, params);

      // Check if it's a SELECT query
      const isSelect = validatedQuery.toUpperCase().trim().startsWith('SELECT');

      if (isSelect) {
        const rows = result.rows.slice(0, maxRows);
        const truncated = result.rows.length > maxRows;

        return {
          success: true,
          rows,
          row_count: rows.length,
          columns: result.fields?.map(f => f.name) || [],
          truncated,
        };
      } else {
        return {
          success: true,
          rows: [],
          row_count: result.rowCount || 0,
          columns: [],
          message: `${result.rowCount} rows affected`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new PostgresClientError(`Query failed: ${message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Get EXPLAIN plan for a query
   */
  async explainQuery(query: string, analyze: boolean = false): Promise<ExplainResult> {
    // Only allow EXPLAIN on SELECT queries
    validateQuery(query, false);

    let explainCmd = 'EXPLAIN (FORMAT JSON';
    if (analyze) {
      explainCmd += ', ANALYZE, BUFFERS';
    }
    explainCmd += `) ${query}`;

    const client = await this.pool.connect();
    try {
      const result = await client.query(explainCmd);
      if (result.rows.length > 0) {
        const plan = Object.values(result.rows[0])[0];
        return { success: true, plan };
      }
      return { success: false, error: 'No plan returned' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    } finally {
      client.release();
    }
  }

  // ==================== SCHEMA OPERATIONS ====================

  /**
   * List all schemas
   */
  async listSchemas(): Promise<SchemaInfo[]> {
    const query = `
      SELECT schema_name, schema_owner
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
      ORDER BY schema_name
    `;
    const result = await this.pool.query(query);
    return result.rows;
  }

  // ==================== TABLE OPERATIONS ====================

  /**
   * List tables in a schema
   */
  async listTables(schema: string = 'public'): Promise<TableInfo[]> {
    validateIdentifier(schema);
    const query = `
      SELECT table_name, table_type, table_schema
      FROM information_schema.tables 
      WHERE table_schema = $1
      ORDER BY table_name
    `;
    const result = await this.pool.query(query, [schema]);
    return result.rows;
  }

  /**
   * Describe a table
   */
  async describeTable(tableName: string, schema: string = 'public'): Promise<TableDescription> {
    validateIdentifier(tableName);
    validateIdentifier(schema);

    const description: TableDescription = {
      schema,
      name: tableName,
      columns: [],
      primary_keys: [],
      foreign_keys: [],
    };

    const client = await this.pool.connect();
    try {
      // Get columns
      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, tableName]);
      description.columns = columnsResult.rows;

      // Get primary keys
      const pkResult = await client.query(`
        SELECT column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = $1 
          AND tc.table_name = $2
          AND tc.constraint_type = 'PRIMARY KEY'
      `, [schema, tableName]);
      description.primary_keys = pkResult.rows.map(r => r.column_name);

      // Get foreign keys
      const fkResult = await client.query(`
        SELECT kcu.column_name,
               ccu.table_name AS foreign_table_name,
               ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.table_schema = $1 
          AND tc.table_name = $2
          AND tc.constraint_type = 'FOREIGN KEY'
      `, [schema, tableName]);
      description.foreign_keys = fkResult.rows.map(r => ({
        column: r.column_name,
        references: `${r.foreign_table_name}.${r.foreign_column_name}`,
      }));

      return description;
    } finally {
      client.release();
    }
  }

  // ==================== INDEX OPERATIONS ====================

  /**
   * List indexes for a table
   */
  async listIndexes(tableName: string, schema: string = 'public'): Promise<IndexInfo[]> {
    validateIdentifier(tableName);
    validateIdentifier(schema);

    const query = `
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
      WHERE n.nspname = $1
        AND t.relname = $2
      ORDER BY i.relname
    `;
    const result = await this.pool.query(query, [schema, tableName]);
    return result.rows;
  }

  // ==================== CONSTRAINT OPERATIONS ====================

  /**
   * List constraints for a table
   */
  async listConstraints(tableName: string, schema: string = 'public'): Promise<ConstraintInfo[]> {
    validateIdentifier(tableName);
    validateIdentifier(schema);

    const query = `
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
      WHERE tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY tc.constraint_type, tc.constraint_name
    `;
    const result = await this.pool.query(query, [schema, tableName]);
    return result.rows;
  }

  // ==================== VIEW OPERATIONS ====================

  /**
   * List views in a schema
   */
  async listViews(schema: string = 'public'): Promise<ViewInfo[]> {
    validateIdentifier(schema);
    const query = `
      SELECT table_name, table_schema
      FROM information_schema.views 
      WHERE table_schema = $1
      ORDER BY table_name
    `;
    const result = await this.pool.query(query, [schema]);
    return result.rows;
  }

  /**
   * Describe a view
   */
  async describeView(viewName: string, schema: string = 'public'): Promise<ViewDescription> {
    validateIdentifier(viewName);
    validateIdentifier(schema);

    const description: ViewDescription = {
      name: viewName,
      schema,
      definition: '',
      columns: [],
    };

    const client = await this.pool.connect();
    try {
      // Get view definition
      const defResult = await client.query(`
        SELECT view_definition
        FROM information_schema.views
        WHERE table_schema = $1 AND table_name = $2
      `, [schema, viewName]);
      if (defResult.rows.length > 0) {
        description.definition = defResult.rows[0].view_definition;
      }

      // Get columns
      const colsResult = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, viewName]);
      description.columns = colsResult.rows;

      return description;
    } finally {
      client.release();
    }
  }

  // ==================== FUNCTION OPERATIONS ====================

  /**
   * List functions in a schema
   */
  async listFunctions(schema: string = 'public'): Promise<FunctionInfo[]> {
    validateIdentifier(schema);
    const query = `
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
      WHERE n.nspname = $1
        AND p.proname NOT LIKE 'pg_%'
      ORDER BY p.proname
    `;
    const result = await this.pool.query(query, [schema]);
    return result.rows;
  }

  // ==================== STATISTICS ====================

  /**
   * Get table statistics
   */
  async getTableStats(tableName: string, schema: string = 'public'): Promise<TableStats | null> {
    validateIdentifier(tableName);
    validateIdentifier(schema);

    const query = `
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
      WHERE schemaname = $1 AND relname = $2
    `;
    const result = await this.pool.query(query, [schema, tableName]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  // ==================== DATABASE INFO ====================

  /**
   * Get database information
   */
  async getDatabaseInfo(): Promise<DatabaseInfo> {
    const client = await this.pool.connect();
    try {
      const versionResult = await client.query('SELECT version()');
      const infoResult = await client.query(`
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
      `);
      const connResult = await client.query(
        'SELECT count(*) AS current_connections FROM pg_stat_activity'
      );

      const info = infoResult.rows[0] || {};
      return {
        ...info,
        version: versionResult.rows[0]?.version || '',
        current_connections: parseInt(connResult.rows[0]?.current_connections || '0', 10),
      };
    } finally {
      client.release();
    }
  }

  // ==================== COLUMN SEARCH ====================

  /**
   * Search for columns by name
   */
  async searchColumns(searchTerm: string, schema?: string): Promise<ColumnSearchResult[]> {
    const searchPattern = `%${escapeLikePattern(searchTerm)}%`;

    let query = `
      SELECT 
        table_schema,
        table_name,
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns
      WHERE column_name ILIKE $1
    `;
    const params: (string | null)[] = [searchPattern];

    if (schema) {
      validateIdentifier(schema);
      query += ' AND table_schema = $2';
      params.push(schema);
    }

    query += `
      AND table_schema NOT IN ('information_schema', 'pg_catalog')
      ORDER BY table_schema, table_name, column_name
      LIMIT 100
    `;

    const result = await this.pool.query(query, params);
    return result.rows;
  }
}

// Singleton instance
let clientInstance: PostgresClient | null = null;

/**
 * Get or create the PostgresClient singleton
 */
export function getClient(): PostgresClient {
  if (!clientInstance) {
    clientInstance = new PostgresClient();
  }
  return clientInstance;
}

/**
 * Reset the client singleton (useful for testing)
 */
export function resetClient(): void {
  if (clientInstance) {
    clientInstance.close();
    clientInstance = null;
  }
}

