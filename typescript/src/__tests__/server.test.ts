/**
 * Smoke tests for the MCP server wiring.
 *
 * These drive a real client against a real server over an in-memory transport,
 * so they exercise the SDK v2 request plumbing (method-string handlers,
 * capability advertisement, error shape) rather than calling the handlers
 * directly. No PostgreSQL instance is needed: every assertion here is about the
 * protocol surface, and the one tool call made is expected to fail.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';

import { createServer, VERSION } from '../server.js';

/** Tool names the server has always exposed. A rename here is a breaking change. */
const EXPECTED_TOOLS = [
  'query',
  'execute',
  'explain_query',
  'list_schemas',
  'list_tables',
  'describe_table',
  'table_stats',
  'list_indexes',
  'list_constraints',
  'list_views',
  'describe_view',
  'list_functions',
  'get_database_info',
  'search_columns',
  'list_databases',
];

/** Everything except list_databases, which reads configuration, not a database. */
const DATABASE_TOOLS = EXPECTED_TOOLS.filter((t) => t !== 'list_databases');

describe('MCP server', () => {
  let client: Client;
  let serverHandle: StdioServerHandle;

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    serverHandle = serveStdio(() => createServer(), { transport: serverTransport });
    client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    );

    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await serverHandle.close();
  });

  it('advertises every tool, and only those', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('gives every tool a description and an input schema', async () => {
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.description, `${tool.name} has no description`).toBeTruthy();
      expect(tool.inputSchema, `${tool.name} has no inputSchema`).toBeTruthy();
    }
  });

  it('offers the database argument on every database tool', async () => {
    const { tools } = await client.listTools();

    for (const name of DATABASE_TOOLS) {
      const tool = tools.find((t) => t.name === name)!;
      const properties = tool.inputSchema.properties as Record<string, unknown> | undefined;

      expect(properties?.database, `${name} has no database argument`).toBeDefined();
      // Optional everywhere: omitting it must keep meaning "the default one".
      expect(tool.inputSchema.required ?? []).not.toContain('database');
    }
  });

  it('does not put a database argument on list_databases', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'list_databases')!;

    expect((tool.inputSchema.properties as Record<string, unknown>).database).toBeUndefined();
  });

  it('never offers a way to pass credentials as tool arguments', async () => {
    // The whole point of aliases: secrets stay in the environment.
    const { tools } = await client.listTools();
    const forbidden = ['password', 'host', 'user', 'connection_string', 'url', 'dsn'];

    for (const tool of tools) {
      const properties = Object.keys((tool.inputSchema.properties ?? {}) as object);
      for (const key of forbidden) {
        expect(properties, `${tool.name} accepts "${key}"`).not.toContain(key);
      }
    }
  });

  it('exposes resources', async () => {
    const { resources } = await client.listResources();

    expect(resources.length).toBeGreaterThan(0);
    for (const resource of resources) {
      expect(resource.uri).toMatch(/^postgres:\/\//);
    }
  });

  it('exposes prompts and renders one without touching the database', async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.length).toBeGreaterThan(0);

    const result = await client.getPrompt({ name: 'explore_database', arguments: {} });
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('reports an unknown tool as a tool error rather than throwing', async () => {
    // Failures come back as isError so the model can read and recover from them,
    // instead of surfacing as a protocol-level error.
    const result = await client.callTool({ name: 'no_such_tool', arguments: {} });

    expect(result.isError).toBe(true);
  });

  it('reports its version', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'postgres-mcp', version: VERSION });
  });

  it('negotiates the modern MCP protocol and discovery metadata', async () => {
    const result = await client.listTools();

    expect(client.getProtocolEra()).toBe('modern');
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    expect(client.getDiscoverResult()?.supportedVersions).toContain('2026-07-28');
    expect(result.ttlMs).toBe(0);
    expect(result.cacheScope).toBe('private');
  });
});
