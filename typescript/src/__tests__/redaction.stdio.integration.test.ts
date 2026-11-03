/**
 * End to end: the built server, launched as a subprocess and driven over stdio
 * by a real MCP client, returns redacted rows. This is the exact path a
 * desktop client takes, so it proves the environment variables reach the
 * server and the masked values are what goes over the wire.
 *
 * Skipped unless POSTGRES_USER/PASSWORD/DB are set (they are in CI).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/index.js');
const hasDatabase = Boolean(
  process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB
);

describe.skipIf(!hasDatabase)('redaction over stdio', () => {
  let client: Client;

  beforeAll(async () => {
    if (!existsSync(DIST)) {
      throw new Error(`Built server not found at ${DIST} — run "npm run build" first.`);
    }
    const connections = [
      {
        alias: 'db',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
        sslmode: process.env.POSTGRES_SSLMODE || 'disable',
      },
    ];
    client = new Client({ name: 'redaction-e2e', version: '1.0.0' });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [DIST],
        env: {
          ...process.env,
          POSTGRES_CONNECTIONS: JSON.stringify(connections),
          REDACT_PII: 'true',
          REDACT_COLUMNS: 'support_tickets.c1',
        } as Record<string, string>,
      })
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it('sends masked values and the tally to the client', async () => {
    const result = await client.callTool({
      name: 'query',
      arguments: { sql: 'SELECT notes, ref, c1 FROM support_tickets WHERE id = 1' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;

    // Nothing personal anywhere in what crossed the wire.
    for (const secret of ['ana.garcia@corp.es', '600 123 456', '12345678Z', '234567890124', '555']) {
      expect(text).not.toContain(secret);
    }
    const payload = JSON.parse(text);
    expect(payload.rows[0]).toEqual({
      notes: 'Llamar a Ana al [REDACTED:phone] o escribir a [REDACTED:email]; DNI [REDACTED:es_dni]',
      ref: '[REDACTED:in_aadhaar]',
      c1: '[REDACTED:column]',
    });
    expect(payload.redacted).toEqual({ phone: 1, email: 1, es_dni: 1, in_aadhaar: 1, column: 1 });
  });

  it('strips values from errors that cross the wire', async () => {
    const result = await client.callTool({
      name: 'query',
      arguments: { sql: 'SELECT notes::int FROM support_tickets WHERE id = 1' },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(result.isError).toBe(true);
    expect(text).not.toContain('ana.garcia');
  });
});
