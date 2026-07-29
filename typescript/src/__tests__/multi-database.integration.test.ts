/**
 * Multi-connection behaviour against a real PostgreSQL server.
 *
 * connections.test.ts covers configuration parsing without a database. This one
 * proves the part that only a live server can: that a pool is actually opened
 * per alias and that the per-connection write permission gates real calls.
 *
 * Skipped unless POSTGRES_USER/PASSWORD/DB are set (they are in CI, which runs a
 * postgres:16 service). Two aliases deliberately point at the *same* server with
 * different permissions — the thing under test is the aliasing, not the data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { resetSettings } from '../settings.js';
import { handleToolCall } from '../tools.js';
import { resetClient } from '../client.js';

const hasDatabase = Boolean(
  process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB
);

const saved: Record<string, string | undefined> = {};

describe.skipIf(!hasDatabase)('multiple connections against a live server', () => {
  beforeAll(() => {
    for (const key of ['POSTGRES_CONNECTIONS', 'ALLOW_WRITE_OPERATIONS']) {
      saved[key] = process.env[key];
    }

    const base = {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      sslmode: process.env.POSTGRES_SSLMODE || 'disable',
    };

    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'readonly', ...base, allowWrite: false, default: true },
      { alias: 'writable', ...base, allowWrite: true },
    ]);
    delete process.env.ALLOW_WRITE_OPERATIONS;

    resetSettings();
    resetClient();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetSettings();
    resetClient();
  });

  it('queries successfully through each alias', async () => {
    // Both aliases have to open their own working pool.
    for (const database of ['readonly', 'writable']) {
      const result = (await handleToolCall('list_schemas', { database })) as {
        schemas: unknown[];
      };

      expect(result.schemas.length, `alias ${database} returned no schemas`).toBeGreaterThan(0);
    }
  });

  it('uses the default connection when the argument is omitted', async () => {
    const info = (await handleToolCall('get_database_info', {})) as Record<string, unknown>;

    expect(info).toBeTruthy();
  });

  it('refuses writes on the read-only alias, naming it', async () => {
    const result = (await handleToolCall('execute', {
      database: 'readonly',
      sql: 'CREATE TABLE mcp_should_not_exist (id int)',
    })) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain('readonly');
  });

  it('leaves no trace of the refused write', async () => {
    const result = (await handleToolCall('query', {
      database: 'readonly',
      sql: "SELECT to_regclass('public.mcp_should_not_exist') IS NULL AS absent",
    })) as { rows: Array<{ absent: boolean }> };

    expect(result.rows[0].absent).toBe(true);
  });

  it('does not refuse on the writable alias', async () => {
    // Only the permission gate is under test, not DDL itself: the statement may
    // still be rejected by query validation, but never for lack of permission.
    const result = (await handleToolCall('execute', {
      database: 'writable',
      sql: 'UPDATE pg_temp.nonexistent SET x = 1',
    }).catch((error: Error) => ({ success: false, error: error.message }))) as {
      success: boolean;
      error?: string;
    };

    expect(result.error ?? '').not.toMatch(/disabled/i);
  });

  it('rejects an unknown alias without touching a database', async () => {
    await expect(handleToolCall('list_schemas', { database: 'nope' })).rejects.toThrow(
      /readonly.*writable/s
    );
  });
});
