/**
 * MCP Prompts for PostgreSQL Server
 */

import { Prompt, GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Prompt definitions for the MCP server
 */
export const promptDefinitions: Prompt[] = [
  {
    name: 'explore_database',
    description: 'Explore the database structure and understand the schema',
    arguments: [],
  },
  {
    name: 'query_builder',
    description: 'Help build SQL queries for a specific table',
    arguments: [
      {
        name: 'table_name',
        description: 'Table to query',
        required: true,
      },
    ],
  },
  {
    name: 'performance_analysis',
    description: 'Analyze table performance and suggest optimizations',
    arguments: [
      {
        name: 'table_name',
        description: 'Table to analyze',
        required: true,
      },
    ],
  },
  {
    name: 'data_dictionary',
    description: 'Generate a data dictionary for a schema',
    arguments: [
      {
        name: 'schema',
        description: 'Schema to document (default: public)',
        required: false,
      },
    ],
  },
];

/**
 * Handle prompt get requests
 */
export function handlePromptGet(
  name: string,
  args: Record<string, string>
): GetPromptResult {
  switch (name) {
    case 'explore_database':
      return promptExploreDatabase();
    case 'query_builder':
      return promptQueryBuilder(args.table_name);
    case 'performance_analysis':
      return promptPerformanceAnalysis(args.table_name);
    case 'data_dictionary':
      return promptDataDictionary(args.schema || 'public');
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}

function promptExploreDatabase(): GetPromptResult {
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
        role: 'user',
        content: { type: 'text', text: content },
      },
    ],
  };
}

function promptQueryBuilder(tableName: string): GetPromptResult {
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
        role: 'user',
        content: { type: 'text', text: content },
      },
    ],
  };
}

function promptPerformanceAnalysis(tableName: string): GetPromptResult {
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
        role: 'user',
        content: { type: 'text', text: content },
      },
    ],
  };
}

function promptDataDictionary(schema: string): GetPromptResult {
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
        role: 'user',
        content: { type: 'text', text: content },
      },
    ],
  };
}

