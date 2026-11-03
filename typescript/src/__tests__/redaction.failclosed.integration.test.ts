/**
 * Fail closed: when redaction itself throws, the query fails and neither the
 * rows nor the thrown message (which could quote a value) reach the model.
 *
 * Skipped unless POSTGRES_USER/PASSWORD/DB are set (they are in CI).
 */

import { describe, it, expect, afterAll, vi } from 'vitest';

vi.mock('../redaction.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../redaction.js')>();
  return {
    ...original,
    redactRows: () => {
      throw new Error('boom while reading ana.garcia@corp.es');
    },
  };
});

import { resetSettings } from '../settings.js';
import { handleToolCall } from '../tools.js';
import { resetClient } from '../client.js';

const hasDatabase = Boolean(
  process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB
);
const saved = { connections: process.env.POSTGRES_CONNECTIONS, pii: process.env.REDACT_PII };

describe.skipIf(!hasDatabase)('redaction failure', () => {
  afterAll(() => {
    resetClient();
    if (saved.connections === undefined) delete process.env.POSTGRES_CONNECTIONS;
    else process.env.POSTGRES_CONNECTIONS = saved.connections;
    if (saved.pii === undefined) delete process.env.REDACT_PII;
    else process.env.REDACT_PII = saved.pii;
    resetSettings();
  });

  it('withholds the result', async () => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      {
        alias: 'db',
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
        sslmode: process.env.POSTGRES_SSLMODE || 'disable',
      },
    ]);
    process.env.REDACT_PII = 'true';
    resetSettings();
    resetClient();

    const error = await handleToolCall('query', {
      sql: 'SELECT notes FROM support_tickets WHERE id = 1',
    }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/withheld/);
    expect((error as Error).message).not.toContain('ana.garcia');
  });
});
