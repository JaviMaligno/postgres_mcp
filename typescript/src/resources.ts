/**
 * MCP Resources for PostgreSQL Server
 */

import { Resource } from '@modelcontextprotocol/sdk/types.js';
import { getClient } from './client.js';

/**
 * Resource definitions for the MCP server
 */
export const resourceDefinitions: Resource[] = [
  {
    uri: 'postgres://schemas',
    name: 'Database Schemas',
    description: 'List all schemas in the database',
    mimeType: 'text/markdown',
  },
  {
    uri: 'postgres://schemas/{schema}/tables',
    name: 'Schema Tables',
    description: 'List tables in a specific schema',
    mimeType: 'text/markdown',
  },
  {
    uri: 'postgres://schemas/{schema}/tables/{table}',
    name: 'Table Details',
    description: 'Get detailed information about a table',
    mimeType: 'text/markdown',
  },
  {
    uri: 'postgres://database',
    name: 'Database Info',
    description: 'Get database information',
    mimeType: 'text/markdown',
  },
];

/**
 * Handle resource read requests
 */
export async function handleResourceRead(uri: string): Promise<string> {
  const client = getClient();

  if (uri === 'postgres://schemas') {
    return await resourceSchemas(client);
  }

  if (uri === 'postgres://database') {
    return await resourceDatabase(client);
  }

  // Match schema tables
  const tablesMatch = uri.match(/^postgres:\/\/schemas\/([^/]+)\/tables$/);
  if (tablesMatch) {
    return await resourceTables(client, tablesMatch[1]);
  }

  // Match table details
  const tableMatch = uri.match(/^postgres:\/\/schemas\/([^/]+)\/tables\/([^/]+)$/);
  if (tableMatch) {
    return await resourceTableDetail(client, tableMatch[1], tableMatch[2]);
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}

async function resourceSchemas(client: ReturnType<typeof getClient>): Promise<string> {
  const schemas = await client.listSchemas();
  const lines = ['# Database Schemas', ''];
  
  for (const s of schemas) {
    lines.push(`- **${s.schema_name}** (owner: ${s.schema_owner})`);
  }
  
  return lines.join('\n');
}

async function resourceTables(client: ReturnType<typeof getClient>, schema: string): Promise<string> {
  const tables = await client.listTables(schema);
  const lines = [`# Tables in '${schema}'`, ''];
  
  if (tables.length === 0) {
    lines.push('No tables found.');
  }
  
  for (const t of tables) {
    const icon = t.table_type === 'BASE TABLE' ? '📋' : '👁';
    lines.push(`- ${icon} **${t.table_name}** (${t.table_type})`);
  }
  
  return lines.join('\n');
}

async function resourceTableDetail(
  client: ReturnType<typeof getClient>,
  schema: string,
  table: string
): Promise<string> {
  const info = await client.describeTable(table, schema);
  const lines = [`# ${schema}.${table}`, ''];
  
  // Columns
  lines.push('## Columns');
  lines.push('');
  lines.push('| Column | Type | Nullable | Default | PK |');
  lines.push('|--------|------|----------|---------|-----|');
  
  const pkSet = new Set(info.primary_keys);
  for (const col of info.columns) {
    const nullable = col.is_nullable === 'YES' ? '✓' : '✗';
    const defaultVal = col.column_default || '-';
    const pk = pkSet.has(col.column_name) ? '🔑' : '';
    lines.push(`| ${col.column_name} | ${col.data_type} | ${nullable} | ${defaultVal} | ${pk} |`);
  }
  
  // Foreign Keys
  if (info.foreign_keys.length > 0) {
    lines.push('');
    lines.push('## Foreign Keys');
    lines.push('');
    for (const fk of info.foreign_keys) {
      lines.push(`- ${fk.column} → ${fk.references}`);
    }
  }
  
  return lines.join('\n');
}

async function resourceDatabase(client: ReturnType<typeof getClient>): Promise<string> {
  const info = await client.getDatabaseInfo();
  
  const lines = [
    `# Database: ${info.database || 'unknown'}`,
    '',
    `**Version**: ${info.version || 'unknown'}`,
    `**Host**: ${info.host || 'localhost'}:${info.port || 5432}`,
    `**User**: ${info.user || 'unknown'}`,
    `**Encoding**: ${info.encoding || 'UTF8'}`,
    `**Timezone**: ${info.timezone || 'unknown'}`,
    `**Connections**: ${info.current_connections}/${info.max_connections}`,
  ];
  
  return lines.join('\n');
}

