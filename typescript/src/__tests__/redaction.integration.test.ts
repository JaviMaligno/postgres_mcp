/**
 * Redaction against the seeded sample database, through the real `query` tool.
 *
 * support_tickets (python/scripts/init_sample_db.sql) hides personal data where
 * a column name gives no hint: free text, columns called `ref` and `c1`, nested
 * JSON and arrays. Mirrors python/tests/test_redaction_integration.py.
 *
 * Skipped unless POSTGRES_USER/PASSWORD/DB are set (they are in CI).
 */

import { describe, it, expect, afterEach, afterAll } from 'vitest';

import { resetSettings } from '../settings.js';
import { handleToolCall } from '../tools.js';
import { resetClient } from '../client.js';

const hasDatabase = Boolean(
  process.env.POSTGRES_USER && process.env.POSTGRES_PASSWORD && process.env.POSTGRES_DB
);

const KEYS = ['POSTGRES_CONNECTIONS', 'REDACT_PII', 'REDACT_COLUMNS', 'ALLOWED_COLUMNS'];
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

const TICKETS = 'SELECT * FROM support_tickets ORDER BY id';
type Row = Record<string, unknown>;
type Result = { rows: Row[]; redacted?: Record<string, number> };

function base(extra: Record<string, unknown> = {}) {
  return {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    sslmode: process.env.POSTGRES_SSLMODE || 'disable',
    ...extra,
  };
}

function configure(env: Record<string, string> = {}, connection: Record<string, unknown> = {}) {
  resetClient();
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);
  process.env.POSTGRES_CONNECTIONS = JSON.stringify([{ alias: 'db', ...base(connection) }]);
  resetSettings();
}

async function run(sql: string): Promise<Result> {
  return (await handleToolCall('query', { sql })) as Result;
}

describe.skipIf(!hasDatabase)('redaction against a live server', () => {
  afterEach(() => {
    resetClient();
  });

  afterAll(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetSettings();
  });

  it('changes nothing without configuration', async () => {
    configure();
    const result = await run(TICKETS);
    expect(result.redacted).toBeUndefined();
    expect(result.rows[0].ref).toBe('234567890124');
    expect(result.rows[0].notes).toContain('ana.garcia@corp.es');
  });

  describe('pattern detection', () => {
    it('finds personal data regardless of column name', async () => {
      configure({ REDACT_PII: 'true' });
      const result = await run(TICKETS);
      const [first] = result.rows;

      expect(first.notes).toBe(
        'Llamar a Ana al [REDACTED:phone] o escribir a [REDACTED:email]; DNI [REDACTED:es_dni]'
      );
      expect(first.ref).toBe('[REDACTED:in_aadhaar]');
      expect(first.c1).toBe('[REDACTED:phone]');
      expect(first.extra).toEqual({
        contact: { alt_email: '[REDACTED:email]', phones: ['[REDACTED:phone]'] },
        priority: 'high',
      });
      expect(first.tags).toEqual(['vip', 'iban:[REDACTED:iban]']);
      expect(result.redacted).toEqual({ phone: 3, email: 2, es_dni: 1, in_aadhaar: 1, iban: 1 });

      expect(first.subject).toBe('Refund for order 100234567');
      expect(first.email_verified).toBe(true);
      expect(first.amount).toBe('1299.99');
      expect(first.created_at).toBeInstanceOf(Date);
    });

    it('leaves the ticket without personal data untouched', async () => {
      configure({ REDACT_PII: 'true' });
      const redacted = (await run(TICKETS)).rows[1];
      configure();
      expect(redacted).toEqual((await run(TICKETS)).rows[1]);
    });

    it('leaves the rest of the sample database untouched', async () => {
      for (const table of ['products', 'orders', 'order_items']) {
        configure();
        const raw = await run(`SELECT * FROM ${table} ORDER BY id`);
        configure({ REDACT_PII: 'true' });
        const redacted = await run(`SELECT * FROM ${table} ORDER BY id`);
        expect(redacted.rows, table).toEqual(raw.rows);
        expect(redacted.redacted, table).toEqual({});
      }
    });

    it('scans whole rows and JSON', async () => {
      configure({ REDACT_PII: 'true' });
      const [row] = (
        await run('SELECT t AS whole, row_to_json(t) AS j FROM support_tickets t WHERE id = 1')
      ).rows;
      expect(row.whole).not.toContain('ana.garcia@corp.es');
      expect(row.whole).toContain('[REDACTED:email]');
      expect(JSON.stringify(row.j)).not.toContain('ana.garcia@corp.es');
    });

    it('cannot see through transformed values (documented limit)', async () => {
      configure({ REDACT_PII: 'true' });
      const [row] = (
        await run("SELECT replace(notes, '@', ' at ') AS n FROM support_tickets WHERE id = 1")
      ).rows;
      expect(row.n).toContain('ana.garcia at corp.es');
    });
  });

  describe('deny list', () => {
    it('masks whole columns', async () => {
      configure({ REDACT_COLUMNS: 'notes,ref' });
      const [first] = (await run(TICKETS)).rows;
      expect(first.notes).toBe('[REDACTED:column]');
      expect(first.ref).toBe('[REDACTED:column]');
      expect(first.c1).toBe('(555) 123-4567');
    });

    it('follows aliases, subqueries, CTEs, joins and casts', async () => {
      configure({ REDACT_COLUMNS: 'support_tickets.notes' });
      for (const sql of [
        'SELECT notes AS x FROM support_tickets WHERE id = 1',
        'SELECT x FROM (SELECT notes AS x FROM support_tickets) s LIMIT 1',
        // Wrapped: a statement starting with WITH returns no rows here.
        'SELECT * FROM (WITH c AS (SELECT notes FROM support_tickets) SELECT notes AS y FROM c LIMIT 1) s',
        'SELECT t.notes::text AS z FROM support_tickets t JOIN support_tickets u ON u.id = t.id LIMIT 1',
      ]) {
        const [row] = (await run(sql)).rows;
        expect(Object.values(row), sql).toEqual(['[REDACTED:column]']);
      }
    });

    it('masks whole-row references', async () => {
      configure({ REDACT_COLUMNS: 'support_tickets.notes' });
      const [row] = (await run('SELECT t FROM support_tickets t WHERE id = 1')).rows;
      expect(row.t).toBe('[REDACTED:column]');
    });

    it('does not mask unrelated names', async () => {
      configure({ REDACT_COLUMNS: 'email' });
      expect((await run(TICKETS)).rows[0].email_verified).toBe(true);
    });

    it('cannot see computed columns (documented limit)', async () => {
      configure({ REDACT_COLUMNS: 'support_tickets.notes' });
      const [row] = (await run('SELECT upper(notes) AS n FROM support_tickets WHERE id = 1')).rows;
      expect(row.n).toContain('ANA.GARCIA@CORP.ES');
    });
  });

  describe('allow list', () => {
    const ALLOWED = 'support_tickets.id,support_tickets.subject';

    it('returns only listed columns', async () => {
      configure({ ALLOWED_COLUMNS: ALLOWED });
      const result = await run(TICKETS);
      const [first] = result.rows;
      expect(first.id).toBe(1);
      expect(first.subject).toBe('Refund for order 100234567');
      for (const column of ['notes', 'ref', 'c1', 'extra', 'tags', 'amount', 'created_at']) {
        expect(first[column], column).toBe('[REDACTED:not_allowed]');
      }
      expect(result.redacted?.not_allowed).toBeGreaterThan(0);
    });

    it('blocks the bypasses of the other layers', async () => {
      configure({ ALLOWED_COLUMNS: ALLOWED });
      for (const sql of [
        "SELECT replace(notes, '@', ' at ') AS subject FROM support_tickets",
        'SELECT notes AS subject FROM support_tickets',
        'SELECT t AS subject FROM support_tickets t',
        'SELECT subject FROM support_tickets UNION ALL SELECT notes FROM support_tickets',
        'SELECT (SELECT notes FROM support_tickets LIMIT 1) AS subject',
        'SELECT length(notes) AS subject FROM support_tickets',
      ]) {
        for (const row of (await run(sql)).rows) {
          expect(row.subject, sql).toBe('[REDACTED:not_allowed]');
        }
      }
    });

    it('lets aliases of allowed columns through', async () => {
      configure({ ALLOWED_COLUMNS: 'support_tickets.subject' });
      const [row] = (await run('SELECT subject AS s FROM support_tickets WHERE id = 1')).rows;
      expect(row.s).toBe('Refund for order 100234567');
    });

    it('exposes aggregates only through an allowed view', async () => {
      configure({ ALLOWED_COLUMNS: 'ticket_counts.n' });
      expect((await run('SELECT count(*) AS n FROM support_tickets')).rows[0].n).toBe(
        '[REDACTED:not_allowed]'
      );
      // count(*) is bigint, which node-postgres returns as a string.
      expect((await run('SELECT n FROM ticket_counts')).rows[0].n).toBe('2');
    });

    it('still scans allowed columns when detection is on', async () => {
      configure({ ALLOWED_COLUMNS: 'support_tickets.notes', REDACT_PII: 'true' });
      const [row] = (await run('SELECT notes FROM support_tickets WHERE id = 1')).rows;
      expect(row.notes).toContain('[REDACTED:email]');
    });
  });

  describe('errors', () => {
    it('redacts values echoed in errors', async () => {
      configure({ REDACT_COLUMNS: 'support_tickets.notes' });
      const error = await run('SELECT notes::int FROM support_tickets WHERE id = 1').catch(
        (e: Error) => e
      );
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('ana.garcia');
      expect((error as Error).message).toContain('"[REDACTED]"');
    });

    it('leaves errors alone without configuration', async () => {
      configure();
      await expect(run('SELECT notes::int FROM support_tickets WHERE id = 1')).rejects.toThrow(
        /ana\.garcia@corp\.es/
      );
    });

    it('redacts EXPLAIN ANALYZE errors', async () => {
      configure({ REDACT_PII: 'true' });
      const result = (await handleToolCall('explain_query', {
        sql: 'SELECT notes::int FROM support_tickets WHERE id = 1',
        analyze: true,
      })) as { success: boolean; error?: string };
      expect(result.success).toBe(false);
      expect(result.error).not.toContain('ana.garcia');
    });
  });

  it('lets a connection override the global policy', async () => {
    configure({ REDACT_PII: 'true' }, { allowedColumns: ['support_tickets.id'] });
    expect((await run('SELECT ref FROM support_tickets WHERE id = 1')).rows[0].ref).toBe(
      '[REDACTED:not_allowed]'
    );
    configure({ REDACT_PII: 'true' }, { allowedColumns: [] });
    expect((await run('SELECT ref FROM support_tickets WHERE id = 1')).rows[0].ref).toBe(
      '[REDACTED:in_aadhaar]'
    );
  });
});

describe.skipIf(!hasDatabase)('review regressions against a live server', () => {
  const ALLOWED = 'support_tickets.id,support_tickets.subject';
  const errorOf = (sql: string) =>
    run(sql).then(
      () => '',
      (e: Error) => e.message
    );

  afterEach(() => {
    resetClient();
  });

  afterAll(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetSettings();
  });

  it('hides error details under an allow list', async () => {
    configure({ ALLOWED_COLUMNS: ALLOWED });
    for (const sql of [
      "SELECT current_setting(string_agg(notes, ',')) FROM support_tickets",
      'SELECT subject::regclass FROM support_tickets WHERE id = 2',
      "SELECT ('x' || chr(10) || notes)::int FROM support_tickets WHERE id = 1",
      'SELECT make_date(2020, 1, (amount * 100)::int) FROM support_tickets WHERE id = 1',
    ]) {
      const error = await errorOf(sql);
      expect(error, sql).toContain('hidden because an allow list is active');
      for (const secret of ['ana', 'Ana', 'Monitor', '129999']) {
        expect(error, sql).not.toContain(secret);
      }
    }
  });

  it('keeps the condition name so the model can fix its SQL', async () => {
    configure({ ALLOWED_COLUMNS: ALLOWED });
    expect(await errorOf('SELECT nope FROM support_tickets')).toContain(
      'undefined_column, SQLSTATE 42703'
    );
  });

  it('stops temp tables from shadowing an allowed table', async () => {
    configure({ ALLOWED_COLUMNS: 'support_tickets.id' });
    expect(
      await errorOf('SELECT notes AS id INTO TEMP support_tickets FROM public.support_tickets')
    ).toContain('read_only_sql_transaction');
    const ids = (await run('SELECT id FROM support_tickets ORDER BY id')).rows.map((r) => r.id);
    expect(ids).toEqual([1, 2]);
  });

  it('refuses data-modifying CTEs under redaction', async () => {
    configure({ REDACT_PII: 'true' });
    expect(
      await errorOf('WITH u AS (UPDATE support_tickets SET subject = subject RETURNING 1) SELECT 1')
    ).toContain('read_only_sql_transaction');
  });

  it('keeps multiple statements from leaving the read-only transaction', async () => {
    configure({ ALLOWED_COLUMNS: 'support_tickets.subject' });
    for (const sql of [
      'SELECT 1; COMMIT; UPDATE support_tickets SET subject = notes WHERE id = 2',
      'SET TRANSACTION READ WRITE; UPDATE support_tickets SET subject = notes WHERE id = 2',
    ]) {
      expect(await errorOf(sql), sql).not.toBe('');
    }
    configure();
    expect((await run('SELECT subject FROM support_tickets WHERE id = 2')).rows).toEqual([
      { subject: 'Monitor flickering' },
    ]);
  });

  it('does not force read-only reads when nothing is configured', async () => {
    configure();
    expect((await run("SELECT nextval('customers_id_seq') > 0 AS ok")).rows).toEqual([{ ok: true }]);
    configure({ REDACT_PII: 'true' });
    expect(await errorOf("SELECT nextval('customers_id_seq') > 0 AS ok")).toContain(
      'read_only_sql_transaction'
    );
  });
});
