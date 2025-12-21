/**
 * Tool definitions and handlers for PostgreSQL MCP Server
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from './client.js';
import { getSettings } from './settings.js';
import { formatBytes, formatCount, notFoundResponse, formatTimestamp } from './utils.js';

/**
 * All tool definitions for the MCP server
 */
export const toolDefinitions: Tool[] = [
  // Query tools
  {
    name: 'query',
    description: 'Execute a SQL query against the PostgreSQL database. This tool is READ-ONLY by default. Use the "execute" tool for write operations.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL query to execute (SELECT statements only)' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'execute',
    description: 'Execute a write SQL statement (INSERT, UPDATE, DELETE). WARNING: This tool modifies data. Only available if ALLOW_WRITE_OPERATIONS=true is set.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL statement to execute' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'explain_query',
    description: 'Get the execution plan for a SQL query (EXPLAIN).',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL query to explain' },
        analyze: { type: 'boolean', description: 'Actually run the query to get real execution stats (EXPLAIN ANALYZE). Use with caution.', default: false },
      },
      required: ['sql'],
    },
  },
  // Schema tools
  {
    name: 'list_schemas',
    description: 'List all schemas in the PostgreSQL database.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  // Table tools
  {
    name: 'list_tables',
    description: 'List all tables in a specific schema.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', description: 'Schema name (default: public)', default: 'public' },
      },
      required: [],
    },
  },
  {
    name: 'describe_table',
    description: 'Describe the structure of a table including columns, types, and constraints.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Name of the table to describe' },
        schema: { type: 'string', description: 'Schema name (default: public)', default: 'public' },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'table_stats',
    description: 'Get statistics for a table (row count, size, bloat).',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Name of the table' },
        schema: { type: 'string', description: 'Schema name (default: public)', default: 'public' },
      },
      required: ['table_name'],
    },
  },
  // Index tools
  {
    name: 'list_indexes',
    description: 'List all indexes for a table.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Name of the table' },
        schema: { type: 'string', description: 'Schema name (default: public)', default: 'public' },
      },
      required: ['table_name'],
    },
  },
  // Constraint tools
  {
    name: 'list_constraints',
    description: 'List all constraints for a table (PK, FK, UNIQUE, CHECK).',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: { type: 'string', description: 'Name of the table' },
        schema: { type: 'string', description: 'Schema name (default: public)', default: 'public' },
      },
      required: ['table_name'],
    },
  },
  // View tools
  {
    name: 'list_views',
    description: 'List all views in a schema.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', description: 'Schema name (default: public)', default: 'public' },
      },
      required: [],
    },
  },
  {
    name: 'describe_view',
    description: 'Get the definition and columns of a view.',
    inputSchema: {
      type: 'object',
      properties: {
        view_name: { type: 'string', description: 'Name of the view' },
        schema: { type: 'string', description: 'Schema name (default: public)', default: 'public' },
      },
      required: ['view_name'],
    },
  },
  // Function tools
  {
    name: 'list_functions',
    description: 'List all functions and procedures in a schema.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', description: 'Schema name (default: public)', default: 'public' },
      },
      required: [],
    },
  },
  // Database info tools
  {
    name: 'get_database_info',
    description: 'Get database and connection information.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  // Search tools
  {
    name: 'search_columns',
    description: 'Search for columns by name across all tables.',
    inputSchema: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'Column name pattern to search (case-insensitive)' },
        schema: { type: 'string', description: 'Optional schema to limit search (default: all user schemas)' },
      },
      required: ['search_term'],
    },
  },
];

/**
 * Handle tool calls
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = getClient();
  const settings = getSettings();

  switch (name) {
    case 'query': {
      const result = await client.executeQuery(args.sql as string, undefined, {
        allowWrite: false,
        maxRows: settings.maxRows,
      });
      return {
        rows: result.rows,
        row_count: result.row_count,
        columns: result.columns,
        truncated: result.truncated || false,
      };
    }

    case 'execute': {
      if (!settings.allowWriteOperations) {
        return {
          success: false,
          error: 'Write operations are disabled. Set ALLOW_WRITE_OPERATIONS=true to enable.',
        };
      }
      const result = await client.executeQuery(args.sql as string, undefined, {
        allowWrite: true,
      });
      return {
        success: true,
        row_count: result.row_count,
        message: result.message || 'Query executed successfully',
      };
    }

    case 'explain_query': {
      return await client.explainQuery(args.sql as string, args.analyze as boolean);
    }

    case 'list_schemas': {
      const schemas = await client.listSchemas();
      return {
        schemas: schemas.map(s => ({
          name: s.schema_name,
          owner: s.schema_owner,
        })),
      };
    }

    case 'list_tables': {
      const schema = (args.schema as string) || 'public';
      const tables = await client.listTables(schema);
      return {
        schema,
        tables: tables.map(t => ({
          name: t.table_name,
          type: t.table_type,
        })),
      };
    }

    case 'describe_table': {
      const schema = (args.schema as string) || 'public';
      const result = await client.describeTable(args.table_name as string, schema);
      if (result.columns.length === 0) {
        return notFoundResponse('Table', `${schema}.${args.table_name}`);
      }
      return {
        schema,
        table_name: args.table_name,
        columns: result.columns.map(c => ({
          name: c.column_name,
          type: c.data_type,
          nullable: c.is_nullable === 'YES',
          default: c.column_default,
          is_primary: result.primary_keys.includes(c.column_name),
        })),
        primary_keys: result.primary_keys,
        foreign_keys: result.foreign_keys,
      };
    }

    case 'table_stats': {
      const schema = (args.schema as string) || 'public';
      const stats = await client.getTableStats(args.table_name as string, schema);
      if (!stats) {
        return notFoundResponse('Table', `${schema}.${args.table_name}`);
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
        last_analyze: formatTimestamp(stats.last_analyze),
      };
    }

    case 'list_indexes': {
      const schema = (args.schema as string) || 'public';
      const indexes = await client.listIndexes(args.table_name as string, schema);
      return {
        table_name: args.table_name,
        schema,
        indexes: indexes.map(idx => ({
          name: idx.index_name,
          is_unique: idx.is_unique,
          is_primary: idx.is_primary,
          type: idx.index_type,
          size: formatBytes(idx.size_bytes),
          definition: idx.definition,
        })),
      };
    }

    case 'list_constraints': {
      const schema = (args.schema as string) || 'public';
      const constraints = await client.listConstraints(args.table_name as string, schema);
      
      // Group by constraint name
      const grouped: Record<string, {
        name: string;
        type: string;
        columns: string[];
        references_table: string | null;
        references_column: string | null;
        check_clause: string | null;
      }> = {};
      
      for (const c of constraints) {
        if (!grouped[c.constraint_name]) {
          grouped[c.constraint_name] = {
            name: c.constraint_name,
            type: c.constraint_type,
            columns: [],
            references_table: c.references_table,
            references_column: c.references_column,
            check_clause: c.check_clause,
          };
        }
        if (c.column_name) {
          grouped[c.constraint_name].columns.push(c.column_name);
        }
      }

      return {
        table_name: args.table_name,
        schema,
        constraints: Object.values(grouped),
      };
    }

    case 'list_views': {
      const schema = (args.schema as string) || 'public';
      const views = await client.listViews(schema);
      return {
        schema,
        views: views.map(v => ({ name: v.table_name })),
      };
    }

    case 'describe_view': {
      const schema = (args.schema as string) || 'public';
      const result = await client.describeView(args.view_name as string, schema);
      if (!result.definition) {
        return notFoundResponse('View', `${schema}.${args.view_name}`);
      }
      return result;
    }

    case 'list_functions': {
      const schema = (args.schema as string) || 'public';
      const functions = await client.listFunctions(schema);
      return {
        schema,
        functions: functions.map(f => ({
          name: f.routine_name,
          arguments: f.argument_types,
          return_type: f.return_type,
          type: f.routine_type,
        })),
      };
    }

    case 'get_database_info': {
      return await client.getDatabaseInfo();
    }

    case 'search_columns': {
      const columns = await client.searchColumns(
        args.search_term as string,
        args.schema as string | undefined
      );
      return {
        search_term: args.search_term,
        schema_filter: args.schema || null,
        matches: columns,
        count: columns.length,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

