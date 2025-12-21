#!/usr/bin/env node

// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

// src/settings.ts
import { z } from "zod";
var settingsSchema = z.object({
  postgresHost: z.string().default("localhost"),
  postgresPort: z.number().min(1).max(65535).default(5432),
  postgresUser: z.string().min(1, "POSTGRES_USER is required"),
  postgresPassword: z.string().min(1, "POSTGRES_PASSWORD is required"),
  postgresDb: z.string().min(1, "POSTGRES_DB is required"),
  postgresSslmode: z.enum(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]).default("prefer"),
  allowWriteOperations: z.boolean().default(false),
  queryTimeout: z.number().min(1).max(300).default(30),
  maxRows: z.number().min(1).max(1e4).default(1e3)
});
var cachedSettings = null;
function getSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }
  const rawSettings = {
    postgresHost: process.env.POSTGRES_HOST || "localhost",
    postgresPort: parseInt(process.env.POSTGRES_PORT || "5432", 10),
    postgresUser: process.env.POSTGRES_USER || "",
    postgresPassword: process.env.POSTGRES_PASSWORD || "",
    postgresDb: process.env.POSTGRES_DB || "",
    postgresSslmode: process.env.POSTGRES_SSLMODE || "prefer",
    allowWriteOperations: process.env.ALLOW_WRITE_OPERATIONS === "true",
    queryTimeout: parseInt(process.env.QUERY_TIMEOUT || "30", 10),
    maxRows: parseInt(process.env.MAX_ROWS || "1000", 10)
  };
  const result = settingsSchema.safeParse(rawSettings);
  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
    throw new Error(`Configuration error: ${errors}`);
  }
  cachedSettings = result.data;
  return cachedSettings;
}
function getConnectionConfig() {
  const settings = getSettings();
  const config = {
    host: settings.postgresHost,
    port: settings.postgresPort,
    user: settings.postgresUser,
    password: settings.postgresPassword,
    database: settings.postgresDb,
    statement_timeout: settings.queryTimeout * 1e3
  };
  if (settings.postgresSslmode !== "disable") {
    config.ssl = {
      rejectUnauthorized: ["verify-ca", "verify-full"].includes(settings.postgresSslmode)
    };
  }
  return config;
}

// src/client.ts
import pg from "pg";

// src/security.ts
var SQLValidationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SQLValidationError";
  }
};
var DANGEROUS_PATTERNS = [
  /;\s*DROP\s+/i,
  /;\s*DELETE\s+/i,
  /;\s*TRUNCATE\s+/i,
  /;\s*ALTER\s+/i,
  /;\s*CREATE\s+/i,
  /;\s*GRANT\s+/i,
  /;\s*REVOKE\s+/i,
  /--.*$/gm,
  // SQL comments
  /\/\*[\s\S]*?\*\//g,
  // Block comments
  /xp_cmdshell/i,
  /exec\s*\(/i,
  /execute\s*\(/i
];
var WRITE_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "DROP", "ALTER", "CREATE", "GRANT", "REVOKE"];
function validateQuery(query, allowWrite = false) {
  if (!query || typeof query !== "string") {
    throw new SQLValidationError("Query must be a non-empty string");
  }
  const trimmedQuery = query.trim();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmedQuery)) {
      throw new SQLValidationError("Query contains potentially dangerous patterns");
    }
  }
  if (!allowWrite) {
    const upperQuery = trimmedQuery.toUpperCase();
    for (const keyword of WRITE_KEYWORDS) {
      if (upperQuery.startsWith(keyword) || new RegExp(`^\\s*${keyword}\\s`, "i").test(trimmedQuery)) {
        throw new SQLValidationError(
          `Write operation '${keyword}' is not allowed. Set ALLOW_WRITE_OPERATIONS=true to enable.`
        );
      }
    }
  }
  const validStartKeywords = ["SELECT", "WITH", "EXPLAIN", "SHOW", "DESCRIBE", "SET"];
  if (allowWrite) {
    validStartKeywords.push(...WRITE_KEYWORDS);
  }
  const startsWithValid = validStartKeywords.some(
    (keyword) => trimmedQuery.toUpperCase().startsWith(keyword)
  );
  if (!startsWithValid) {
    throw new SQLValidationError(
      `Query must start with one of: ${validStartKeywords.join(", ")}`
    );
  }
  return trimmedQuery;
}
function validateIdentifier(identifier) {
  if (!identifier || typeof identifier !== "string") {
    throw new SQLValidationError("Identifier must be a non-empty string");
  }
  const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
  if (!identifierPattern.test(identifier)) {
    throw new SQLValidationError(
      `Invalid identifier '${identifier}'. Must start with a letter or underscore and contain only letters, digits, underscores, or dollar signs.`
    );
  }
  if (identifier.length > 63) {
    throw new SQLValidationError(
      `Identifier '${identifier}' exceeds maximum length of 63 characters`
    );
  }
  return true;
}
function escapeLikePattern(value) {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// src/client.ts
var { Pool } = pg;
var PostgresClientError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PostgresClientError";
  }
};
var PostgresClient = class {
  pool;
  constructor() {
    const config = getConnectionConfig();
    this.pool = new Pool(config);
  }
  /**
   * Close the connection pool
   */
  async close() {
    await this.pool.end();
  }
  // ==================== QUERY EXECUTION ====================
  /**
   * Execute a SQL query
   */
  async executeQuery(query, params, options = {}) {
    const settings = getSettings();
    const { allowWrite = false, maxRows = settings.maxRows } = options;
    const validatedQuery = validateQuery(query, allowWrite);
    const client = await this.pool.connect();
    try {
      const result = await client.query(validatedQuery, params);
      const isSelect = validatedQuery.toUpperCase().trim().startsWith("SELECT");
      if (isSelect) {
        const rows = result.rows.slice(0, maxRows);
        const truncated = result.rows.length > maxRows;
        return {
          success: true,
          rows,
          row_count: rows.length,
          columns: result.fields?.map((f) => f.name) || [],
          truncated
        };
      } else {
        return {
          success: true,
          rows: [],
          row_count: result.rowCount || 0,
          columns: [],
          message: `${result.rowCount} rows affected`
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new PostgresClientError(`Query failed: ${message}`);
    } finally {
      client.release();
    }
  }
  /**
   * Get EXPLAIN plan for a query
   */
  async explainQuery(query, analyze = false) {
    validateQuery(query, false);
    let explainCmd = "EXPLAIN (FORMAT JSON";
    if (analyze) {
      explainCmd += ", ANALYZE, BUFFERS";
    }
    explainCmd += `) ${query}`;
    const client = await this.pool.connect();
    try {
      const result = await client.query(explainCmd);
      if (result.rows.length > 0) {
        const plan = Object.values(result.rows[0])[0];
        return { success: true, plan };
      }
      return { success: false, error: "No plan returned" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: message };
    } finally {
      client.release();
    }
  }
  // ==================== SCHEMA OPERATIONS ====================
  /**
   * List all schemas
   */
  async listSchemas() {
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
  async listTables(schema = "public") {
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
  async describeTable(tableName, schema = "public") {
    validateIdentifier(tableName);
    validateIdentifier(schema);
    const description = {
      schema,
      name: tableName,
      columns: [],
      primary_keys: [],
      foreign_keys: []
    };
    const client = await this.pool.connect();
    try {
      const columnsResult = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `, [schema, tableName]);
      description.columns = columnsResult.rows;
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
      description.primary_keys = pkResult.rows.map((r) => r.column_name);
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
      description.foreign_keys = fkResult.rows.map((r) => ({
        column: r.column_name,
        references: `${r.foreign_table_name}.${r.foreign_column_name}`
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
  async listIndexes(tableName, schema = "public") {
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
  async listConstraints(tableName, schema = "public") {
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
  async listViews(schema = "public") {
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
  async describeView(viewName, schema = "public") {
    validateIdentifier(viewName);
    validateIdentifier(schema);
    const description = {
      name: viewName,
      schema,
      definition: "",
      columns: []
    };
    const client = await this.pool.connect();
    try {
      const defResult = await client.query(`
        SELECT view_definition
        FROM information_schema.views
        WHERE table_schema = $1 AND table_name = $2
      `, [schema, viewName]);
      if (defResult.rows.length > 0) {
        description.definition = defResult.rows[0].view_definition;
      }
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
  async listFunctions(schema = "public") {
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
  async getTableStats(tableName, schema = "public") {
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
  async getDatabaseInfo() {
    const client = await this.pool.connect();
    try {
      const versionResult = await client.query("SELECT version()");
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
        "SELECT count(*) AS current_connections FROM pg_stat_activity"
      );
      const info = infoResult.rows[0] || {};
      return {
        ...info,
        version: versionResult.rows[0]?.version || "",
        current_connections: parseInt(connResult.rows[0]?.current_connections || "0", 10)
      };
    } finally {
      client.release();
    }
  }
  // ==================== COLUMN SEARCH ====================
  /**
   * Search for columns by name
   */
  async searchColumns(searchTerm, schema) {
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
    const params = [searchPattern];
    if (schema) {
      validateIdentifier(schema);
      query += " AND table_schema = $2";
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
};
var clientInstance = null;
function getClient() {
  if (!clientInstance) {
    clientInstance = new PostgresClient();
  }
  return clientInstance;
}

// src/utils.ts
function formatBytes(bytes) {
  if (bytes === null || bytes === void 0) {
    return "N/A";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let size = bytes;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}
function formatCount(count) {
  if (count === null || count === void 0) {
    return "N/A";
  }
  return count.toLocaleString();
}
function notFoundResponse(type, identifier) {
  return {
    error: `${type} '${identifier}' not found`,
    found: false
  };
}
function formatTimestamp(date) {
  if (!date) {
    return null;
  }
  if (date instanceof Date) {
    return date.toISOString();
  }
  return String(date);
}

// src/tools.ts
var toolDefinitions = [
  // Query tools
  {
    name: "query",
    description: 'Execute a SQL query against the PostgreSQL database. This tool is READ-ONLY by default. Use the "execute" tool for write operations.',
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query to execute (SELECT statements only)" }
      },
      required: ["sql"]
    }
  },
  {
    name: "execute",
    description: "Execute a write SQL statement (INSERT, UPDATE, DELETE). WARNING: This tool modifies data. Only available if ALLOW_WRITE_OPERATIONS=true is set.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL statement to execute" }
      },
      required: ["sql"]
    }
  },
  {
    name: "explain_query",
    description: "Get the execution plan for a SQL query (EXPLAIN).",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL query to explain" },
        analyze: { type: "boolean", description: "Actually run the query to get real execution stats (EXPLAIN ANALYZE). Use with caution.", default: false }
      },
      required: ["sql"]
    }
  },
  // Schema tools
  {
    name: "list_schemas",
    description: "List all schemas in the PostgreSQL database.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  // Table tools
  {
    name: "list_tables",
    description: "List all tables in a specific schema.",
    inputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: []
    }
  },
  {
    name: "describe_table",
    description: "Describe the structure of a table including columns, types, and constraints.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Name of the table to describe" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["table_name"]
    }
  },
  {
    name: "table_stats",
    description: "Get statistics for a table (row count, size, bloat).",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Name of the table" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["table_name"]
    }
  },
  // Index tools
  {
    name: "list_indexes",
    description: "List all indexes for a table.",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Name of the table" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["table_name"]
    }
  },
  // Constraint tools
  {
    name: "list_constraints",
    description: "List all constraints for a table (PK, FK, UNIQUE, CHECK).",
    inputSchema: {
      type: "object",
      properties: {
        table_name: { type: "string", description: "Name of the table" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["table_name"]
    }
  },
  // View tools
  {
    name: "list_views",
    description: "List all views in a schema.",
    inputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: []
    }
  },
  {
    name: "describe_view",
    description: "Get the definition and columns of a view.",
    inputSchema: {
      type: "object",
      properties: {
        view_name: { type: "string", description: "Name of the view" },
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: ["view_name"]
    }
  },
  // Function tools
  {
    name: "list_functions",
    description: "List all functions and procedures in a schema.",
    inputSchema: {
      type: "object",
      properties: {
        schema: { type: "string", description: "Schema name (default: public)", default: "public" }
      },
      required: []
    }
  },
  // Database info tools
  {
    name: "get_database_info",
    description: "Get database and connection information.",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    }
  },
  // Search tools
  {
    name: "search_columns",
    description: "Search for columns by name across all tables.",
    inputSchema: {
      type: "object",
      properties: {
        search_term: { type: "string", description: "Column name pattern to search (case-insensitive)" },
        schema: { type: "string", description: "Optional schema to limit search (default: all user schemas)" }
      },
      required: ["search_term"]
    }
  }
];
async function handleToolCall(name, args) {
  const client = getClient();
  const settings = getSettings();
  switch (name) {
    case "query": {
      const result = await client.executeQuery(args.sql, void 0, {
        allowWrite: false,
        maxRows: settings.maxRows
      });
      return {
        rows: result.rows,
        row_count: result.row_count,
        columns: result.columns,
        truncated: result.truncated || false
      };
    }
    case "execute": {
      if (!settings.allowWriteOperations) {
        return {
          success: false,
          error: "Write operations are disabled. Set ALLOW_WRITE_OPERATIONS=true to enable."
        };
      }
      const result = await client.executeQuery(args.sql, void 0, {
        allowWrite: true
      });
      return {
        success: true,
        row_count: result.row_count,
        message: result.message || "Query executed successfully"
      };
    }
    case "explain_query": {
      return await client.explainQuery(args.sql, args.analyze);
    }
    case "list_schemas": {
      const schemas = await client.listSchemas();
      return {
        schemas: schemas.map((s) => ({
          name: s.schema_name,
          owner: s.schema_owner
        }))
      };
    }
    case "list_tables": {
      const schema = args.schema || "public";
      const tables = await client.listTables(schema);
      return {
        schema,
        tables: tables.map((t) => ({
          name: t.table_name,
          type: t.table_type
        }))
      };
    }
    case "describe_table": {
      const schema = args.schema || "public";
      const result = await client.describeTable(args.table_name, schema);
      if (result.columns.length === 0) {
        return notFoundResponse("Table", `${schema}.${args.table_name}`);
      }
      return {
        schema,
        table_name: args.table_name,
        columns: result.columns.map((c) => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === "YES",
          default: c.column_default,
          is_primary: result.primary_keys.includes(c.column_name)
        })),
        primary_keys: result.primary_keys,
        foreign_keys: result.foreign_keys
      };
    }
    case "table_stats": {
      const schema = args.schema || "public";
      const stats = await client.getTableStats(args.table_name, schema);
      if (!stats) {
        return notFoundResponse("Table", `${schema}.${args.table_name}`);
      }
      return {
        schema,
        table_name: args.table_name,
        row_count: stats.row_count,
        row_count_formatted: formatCount(stats.row_count),
        dead_tuples: stats.dead_tuples,
        total_size: stats.total_size,
        total_size_formatted: formatBytes(stats.total_size),
        table_size: stats.table_size,
        table_size_formatted: formatBytes(stats.table_size),
        index_size: stats.index_size,
        index_size_formatted: formatBytes(stats.index_size),
        last_vacuum: formatTimestamp(stats.last_vacuum),
        last_analyze: formatTimestamp(stats.last_analyze)
      };
    }
    case "list_indexes": {
      const schema = args.schema || "public";
      const indexes = await client.listIndexes(args.table_name, schema);
      return {
        table_name: args.table_name,
        schema,
        indexes: indexes.map((idx) => ({
          name: idx.index_name,
          is_unique: idx.is_unique,
          is_primary: idx.is_primary,
          type: idx.index_type,
          size: formatBytes(idx.size_bytes),
          definition: idx.definition
        }))
      };
    }
    case "list_constraints": {
      const schema = args.schema || "public";
      const constraints = await client.listConstraints(args.table_name, schema);
      const grouped = {};
      for (const c of constraints) {
        if (!grouped[c.constraint_name]) {
          grouped[c.constraint_name] = {
            name: c.constraint_name,
            type: c.constraint_type,
            columns: [],
            references_table: c.references_table,
            references_column: c.references_column,
            check_clause: c.check_clause
          };
        }
        if (c.column_name) {
          grouped[c.constraint_name].columns.push(c.column_name);
        }
      }
      return {
        table_name: args.table_name,
        schema,
        constraints: Object.values(grouped)
      };
    }
    case "list_views": {
      const schema = args.schema || "public";
      const views = await client.listViews(schema);
      return {
        schema,
        views: views.map((v) => ({ name: v.table_name }))
      };
    }
    case "describe_view": {
      const schema = args.schema || "public";
      const result = await client.describeView(args.view_name, schema);
      if (!result.definition) {
        return notFoundResponse("View", `${schema}.${args.view_name}`);
      }
      return result;
    }
    case "list_functions": {
      const schema = args.schema || "public";
      const functions = await client.listFunctions(schema);
      return {
        schema,
        functions: functions.map((f) => ({
          name: f.routine_name,
          arguments: f.argument_types,
          return_type: f.return_type,
          type: f.routine_type
        }))
      };
    }
    case "get_database_info": {
      return await client.getDatabaseInfo();
    }
    case "search_columns": {
      const columns = await client.searchColumns(
        args.search_term,
        args.schema
      );
      return {
        search_term: args.search_term,
        schema_filter: args.schema || null,
        matches: columns,
        count: columns.length
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// src/resources.ts
var resourceDefinitions = [
  {
    uri: "postgres://schemas",
    name: "Database Schemas",
    description: "List all schemas in the database",
    mimeType: "text/markdown"
  },
  {
    uri: "postgres://schemas/{schema}/tables",
    name: "Schema Tables",
    description: "List tables in a specific schema",
    mimeType: "text/markdown"
  },
  {
    uri: "postgres://schemas/{schema}/tables/{table}",
    name: "Table Details",
    description: "Get detailed information about a table",
    mimeType: "text/markdown"
  },
  {
    uri: "postgres://database",
    name: "Database Info",
    description: "Get database information",
    mimeType: "text/markdown"
  }
];
async function handleResourceRead(uri) {
  const client = getClient();
  if (uri === "postgres://schemas") {
    return await resourceSchemas(client);
  }
  if (uri === "postgres://database") {
    return await resourceDatabase(client);
  }
  const tablesMatch = uri.match(/^postgres:\/\/schemas\/([^/]+)\/tables$/);
  if (tablesMatch) {
    return await resourceTables(client, tablesMatch[1]);
  }
  const tableMatch = uri.match(/^postgres:\/\/schemas\/([^/]+)\/tables\/([^/]+)$/);
  if (tableMatch) {
    return await resourceTableDetail(client, tableMatch[1], tableMatch[2]);
  }
  throw new Error(`Unknown resource URI: ${uri}`);
}
async function resourceSchemas(client) {
  const schemas = await client.listSchemas();
  const lines = ["# Database Schemas", ""];
  for (const s of schemas) {
    lines.push(`- **${s.schema_name}** (owner: ${s.schema_owner})`);
  }
  return lines.join("\n");
}
async function resourceTables(client, schema) {
  const tables = await client.listTables(schema);
  const lines = [`# Tables in '${schema}'`, ""];
  if (tables.length === 0) {
    lines.push("No tables found.");
  }
  for (const t of tables) {
    const icon = t.table_type === "BASE TABLE" ? "\u{1F4CB}" : "\u{1F441}";
    lines.push(`- ${icon} **${t.table_name}** (${t.table_type})`);
  }
  return lines.join("\n");
}
async function resourceTableDetail(client, schema, table) {
  const info = await client.describeTable(table, schema);
  const lines = [`# ${schema}.${table}`, ""];
  lines.push("## Columns");
  lines.push("");
  lines.push("| Column | Type | Nullable | Default | PK |");
  lines.push("|--------|------|----------|---------|-----|");
  const pkSet = new Set(info.primary_keys);
  for (const col of info.columns) {
    const nullable = col.is_nullable === "YES" ? "\u2713" : "\u2717";
    const defaultVal = col.column_default || "-";
    const pk = pkSet.has(col.column_name) ? "\u{1F511}" : "";
    lines.push(`| ${col.column_name} | ${col.data_type} | ${nullable} | ${defaultVal} | ${pk} |`);
  }
  if (info.foreign_keys.length > 0) {
    lines.push("");
    lines.push("## Foreign Keys");
    lines.push("");
    for (const fk of info.foreign_keys) {
      lines.push(`- ${fk.column} \u2192 ${fk.references}`);
    }
  }
  return lines.join("\n");
}
async function resourceDatabase(client) {
  const info = await client.getDatabaseInfo();
  const lines = [
    `# Database: ${info.database || "unknown"}`,
    "",
    `**Version**: ${info.version || "unknown"}`,
    `**Host**: ${info.host || "localhost"}:${info.port || 5432}`,
    `**User**: ${info.user || "unknown"}`,
    `**Encoding**: ${info.encoding || "UTF8"}`,
    `**Timezone**: ${info.timezone || "unknown"}`,
    `**Connections**: ${info.current_connections}/${info.max_connections}`
  ];
  return lines.join("\n");
}

// src/prompts.ts
var promptDefinitions = [
  {
    name: "explore_database",
    description: "Explore the database structure and understand the schema",
    arguments: []
  },
  {
    name: "query_builder",
    description: "Help build SQL queries for a specific table",
    arguments: [
      {
        name: "table_name",
        description: "Table to query",
        required: true
      }
    ]
  },
  {
    name: "performance_analysis",
    description: "Analyze table performance and suggest optimizations",
    arguments: [
      {
        name: "table_name",
        description: "Table to analyze",
        required: true
      }
    ]
  },
  {
    name: "data_dictionary",
    description: "Generate a data dictionary for a schema",
    arguments: [
      {
        name: "schema",
        description: "Schema to document (default: public)",
        required: false
      }
    ]
  }
];
function handlePromptGet(name, args) {
  switch (name) {
    case "explore_database":
      return promptExploreDatabase();
    case "query_builder":
      return promptQueryBuilder(args.table_name);
    case "performance_analysis":
      return promptPerformanceAnalysis(args.table_name);
    case "data_dictionary":
      return promptDataDictionary(args.schema || "public");
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
function promptExploreDatabase() {
  const content = `Please explore this PostgreSQL database and provide an overview.

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
- Any notable patterns or concerns`;
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: content }
      }
    ]
  };
}
function promptQueryBuilder(tableName) {
  const content = `Help me build SQL queries for the '${tableName}' table.

First, use these tools to understand the table structure:
1. describe_table(table_name="${tableName}") - Get columns and types
2. list_indexes(table_name="${tableName}") - See available indexes
3. table_stats(table_name="${tableName}") - Check table size
4. list_constraints(table_name="${tableName}") - See relationships

Then help me write efficient queries by:
- Suggesting relevant columns based on their names/types
- Using indexed columns in WHERE clauses when possible
- Adding appropriate LIMIT clauses for large tables
- Warning about potentially slow operations

Example query patterns to consider:
- Filtering by common columns
- Aggregations and GROUP BY
- JOINs with related tables`;
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: content }
      }
    ]
  };
}
function promptPerformanceAnalysis(tableName) {
  const content = `Analyze the performance characteristics of table '${tableName}'.

Gather information using:
1. table_stats(table_name="${tableName}") - Get size and vacuum stats
2. list_indexes(table_name="${tableName}") - Review existing indexes
3. list_constraints(table_name="${tableName}") - Check constraints
4. describe_table(table_name="${tableName}") - Review column types

Then analyze:
- Table size vs expected row count (potential bloat?)
- Dead tuple percentage (needs VACUUM?)
- Index coverage for common query patterns
- Column types (appropriate for data?)
- Missing indexes on foreign key columns
- Suggestions for optimization

Provide actionable recommendations.`;
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: content }
      }
    ]
  };
}
function promptDataDictionary(schema) {
  const content = `Generate a comprehensive data dictionary for the '${schema}' schema.

Use these tools:
1. list_tables(schema="${schema}") - Get all tables
2. For each table:
   - describe_table(table_name="...", schema="${schema}") - Get structure
   - list_indexes(table_name="...", schema="${schema}") - Get indexes
3. list_views(schema="${schema}") - Get all views
4. list_functions(schema="${schema}") - Get functions

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

Format as markdown suitable for technical documentation.`;
  return {
    messages: [
      {
        role: "user",
        content: { type: "text", text: content }
      }
    ]
  };
}

// src/index.ts
var VERSION = "0.10.0";
function createServer() {
  const server = new Server(
    {
      name: "postgres-mcp",
      version: VERSION
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await handleToolCall(name, args || {});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message }, null, 2)
          }
        ],
        isError: true
      };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resourceDefinitions
    };
  });
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    try {
      const content = await handleResourceRead(uri);
      return {
        contents: [
          {
            uri,
            mimeType: "text/markdown",
            text: content
          }
        ]
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to read resource: ${message}`);
    }
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: promptDefinitions
    };
  });
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = handlePromptGet(name, args || {});
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new Error(`Failed to get prompt: ${message}`);
    }
  });
  return server;
}
async function main() {
  try {
    getSettings();
  } catch (error) {
    console.error("Configuration error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`PostgreSQL MCP Server v${VERSION} started`);
}
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
