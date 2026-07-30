/**
 * Backward-compatibility test: a 2025-era client must keep working.
 *
 * The server was migrated to the 2026-07-28 protocol revision (SDK v2). That
 * revision drops the `initialize` handshake, so the obvious worry is that every
 * already-installed client breaks. It does not: a v2 server is dual-era and
 * still answers the legacy handshake. This test is what proves it, rather than
 * taking the migration guide's word for it.
 *
 * It drives the **built** server (`dist/index.js`) as a real subprocess over
 * stdio using the **v1** SDK client — the same code path Claude Desktop, Cursor
 * and Smithery use today. The v1 and v2 packages only ever meet across the
 * process boundary, which is the supported way to mix them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/index.js');

describe('a 2025-era (SDK v1) client', () => {
  let client: Client;

  beforeAll(async () => {
    if (!existsSync(DIST)) {
      throw new Error(`Built server not found at ${DIST} — run "npm run build" first.`);
    }

    client = new Client({ name: 'legacy-test-client', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [DIST],
        // The server validates settings on startup and exits 1 without them.
        // It never connects to PostgreSQL unless a tool is called.
        env: {
          ...process.env,
          POSTGRES_USER: 'test',
          POSTGRES_PASSWORD: 'test',
          POSTGRES_DB: 'test',
        } as Record<string, string>,
      })
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it('completes the legacy initialize handshake', () => {
    expect(client.getServerVersion()).toMatchObject({ name: 'postgres-mcp' });
  });

  it('lists tools over the legacy protocol', async () => {
    const { tools } = await client.listTools();

    expect(tools.length).toBe(15);
    expect(tools.map((t) => t.name)).toContain('list_schemas');
    // Multi-database works for legacy clients too — nothing about it needs 2026.
    expect(tools.map((t) => t.name)).toContain('list_databases');
  });

  it('lists prompts and resources over the legacy protocol', async () => {
    const [{ prompts }, { resources }] = await Promise.all([
      client.listPrompts(),
      client.listResources(),
    ]);

    expect(prompts.length).toBeGreaterThan(0);
    expect(resources.length).toBeGreaterThan(0);
  });
});
