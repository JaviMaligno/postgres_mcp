/**
 * Personal-data redaction, without a database.
 *
 * The detection cases come from testdata/redaction_vectors.json, the same file
 * the Python suite reads, so both implementations are held to one corpus.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  NO_REDACTION,
  columnsToMask,
  parseColumnRules,
  redactError,
  redactRows,
  redactText,
  redactValue,
  ruleMatches,
  type ColumnMeta,
  type Counts,
  type RedactionPolicy,
} from '../redaction.js';
import { resetSettings, resolveAlias } from '../settings.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(resolve(here, '../../../testdata/redaction_vectors.json'), 'utf-8')
) as {
  detect: Array<{ input: string; output: string; counts: Counts }>;
  keep: string[];
  errors: Array<{ policy: string; sqlstate: string | null; message: string; output: string }>;
};

const policy = (overrides: Partial<RedactionPolicy>): RedactionPolicy => ({
  ...NO_REDACTION,
  ...overrides,
});

describe('shared detection corpus', () => {
  it.each(vectors.detect.map((c) => [c.input, c] as const))('redacts %s', (_input, c) => {
    const counts: Counts = {};
    expect(redactText(c.input, counts)).toBe(c.output);
    expect(counts).toEqual(c.counts);
  });

  it.each(vectors.keep)('keeps %s', (text) => {
    const counts: Counts = {};
    expect(redactText(text, counts)).toBe(text);
    expect(counts).toEqual({});
  });

  it('is idempotent', () => {
    for (const c of vectors.detect) {
      const once = redactText(c.input, {});
      expect(redactText(once, {})).toBe(once);
    }
  });

  it('rarely redacts unformatted numeric identifiers', () => {
    // Deterministic PRNG so the measurement is reproducible.
    let seed = 1234;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const randomDigits = (length: number) =>
      String(1 + Math.floor(next() * 9)) +
      Array.from({ length: length - 1 }, () => Math.floor(next() * 10)).join('');

    for (const length of [8, 9, 10, 11]) {
      for (let i = 0; i < 500; i++) {
        const number = randomDigits(length);
        expect(redactText(number, {})).toBe(number);
      }
    }
    const twelve = Array.from({ length: 2000 }, () => randomDigits(12));
    const hits = twelve.filter((n) => redactText(n, {}) !== n).length;
    expect(hits / twelve.length).toBeLessThan(0.12);
  });

  it('walks JSON values and leaves other types alone', () => {
    const counts: Counts = {};
    const date = new Date('2026-11-03T10:15:00Z');
    expect(
      redactValue({ contact: { emails: ['a@b.io', 'plain'] }, n: 3, ok: true, at: date }, counts)
    ).toEqual({ contact: { emails: ['[REDACTED:email]', 'plain'] }, n: 3, ok: true, at: date });
    expect(counts).toEqual({ email: 1 });
  });
});

describe('column rules', () => {
  it('parses strings and lists', () => {
    expect(parseColumnRules('Email, users.phone ,', 'X')).toEqual(['email', 'users.phone']);
    expect(parseColumnRules(['public.users.ssn'], 'X')).toEqual(['public.users.ssn']);
    expect(parseColumnRules(undefined, 'X')).toEqual([]);
    expect(parseColumnRules('', 'X')).toEqual([]);
  });

  it.each(['a.b.c.d', 'a..b', '.a'])('rejects %s', (bad) => {
    expect(() => parseColumnRules(bad, 'REDACT_COLUMNS')).toThrow(/invalid rule/);
  });

  it('rejects non-strings', () => {
    expect(() => parseColumnRules([1], 'X')).toThrow();
    expect(() => parseColumnRules(5, 'X')).toThrow();
  });

  it('matches bare rules against the result name or the source column', () => {
    const source: [string, string, string] = ['public', 'customers', 'email'];
    expect(ruleMatches('email', 'email', null)).toBe(true);
    expect(ruleMatches('email', 'e', source)).toBe(true);
    expect(ruleMatches('*mail*', 'contact_email', null)).toBe(true);
    expect(ruleMatches('email', 'name', ['public', 'customers', 'name'])).toBe(false);
  });

  it('needs the source for qualified rules', () => {
    const source: [string, string, string] = ['public', 'customers', 'email'];
    expect(ruleMatches('customers.email', 'e', source)).toBe(true);
    expect(ruleMatches('public.customers.email', 'email', source)).toBe(true);
    expect(ruleMatches('public.*.email', 'email', source)).toBe(true);
    expect(ruleMatches('orders.email', 'email', source)).toBe(false);
    expect(ruleMatches('customers.email', 'email', null)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(ruleMatches('email', 'EMAIL', null)).toBe(true);
    expect(ruleMatches('customers.email', 'x', ['public', 'Customers', 'Email'])).toBe(true);
  });

  const COLUMNS: ColumnMeta[] = [
    { name: 'id', source: ['public', 'customers', 'id'] },
    { name: 'contact', source: ['public', 'customers', 'email'] },
    { name: 'total', source: null },
  ];
  const masked = (columns: ColumnMeta[], p: RedactionPolicy) =>
    Object.fromEntries(columnsToMask(columns, p));

  it('applies a deny list', () => {
    expect(masked(COLUMNS, policy({ columns: ['customers.email'] }))).toEqual({
      contact: '[REDACTED:column]',
    });
    expect(masked(COLUMNS, NO_REDACTION)).toEqual({});
  });

  it('denies whole-row references carrying a denied column', () => {
    const row: ColumnMeta = {
      name: 'c',
      source: null,
      rowOf: [
        ['public', 'customers', 'id'],
        ['public', 'customers', 'email'],
      ],
    };
    expect(masked([row], policy({ columns: ['email'] }))).toEqual({ c: '[REDACTED:column]' });
    expect(masked([row], policy({ columns: ['phone'] }))).toEqual({});
  });

  it('masks everything an allow list does not name', () => {
    expect(masked(COLUMNS, policy({ allowed: ['customers.id'] }))).toEqual({
      contact: '[REDACTED:not_allowed]',
      total: '[REDACTED:not_allowed]',
    });
  });

  it('ignores result names in an allow list', () => {
    const renamed: ColumnMeta[] = [{ name: 'id', source: ['public', 'customers', 'email'] }];
    expect(masked(renamed, policy({ allowed: ['id'] }))).toEqual({
      id: '[REDACTED:not_allowed]',
    });
  });

  it('masks computed columns and whole rows under an allow list', () => {
    const computed: ColumnMeta[] = [
      { name: 'e', source: null },
      { name: 'c', source: null, rowOf: [['public', 't', 'id']] },
    ];
    expect(Object.keys(masked(computed, policy({ allowed: ['*'] })))).toEqual(['e', 'c']);
  });

  it('accepts views as allow-list sources', () => {
    const view: ColumnMeta[] = [{ name: 'n', source: ['public', 'v_order_totals', 'n'] }];
    expect(masked(view, policy({ allowed: ['v_order_totals.*'] }))).toEqual({});
  });

  it('lets the deny list win over the allow list', () => {
    expect(masked(COLUMNS, policy({ columns: ['email'], allowed: ['customers.*'] }))).toEqual({
      contact: '[REDACTED:column]',
      total: '[REDACTED:not_allowed]',
    });
  });
});

describe('redactRows', () => {
  const COLUMNS: ColumnMeta[] = [
    { name: 'id', source: ['public', 'customers', 'id'] },
    { name: 'email', source: ['public', 'customers', 'email'] },
    { name: 'notes', source: ['public', 'customers', 'notes'] },
  ];
  const ROWS = [
    { id: 1, email: 'ana@corp.es', notes: 'call +34 600 123 456' },
    { id: 2, email: null, notes: 'nothing' },
  ];

  it('returns rows untouched when disabled', () => {
    expect(redactRows(ROWS, COLUMNS, NO_REDACTION)).toEqual({ rows: ROWS, counts: {} });
  });

  it('masks whole values of denied columns but keeps nulls', () => {
    const { rows, counts } = redactRows(ROWS, COLUMNS, policy({ columns: ['email'] }));
    expect(rows[0].email).toBe('[REDACTED:column]');
    expect(rows[1].email).toBeNull();
    expect(rows[0].notes).toBe('call +34 600 123 456');
    expect(counts).toEqual({ column: 1 });
  });

  it('masks non-string values too', () => {
    const { rows } = redactRows(ROWS, COLUMNS, policy({ columns: ['id'] }));
    expect(rows.map((r) => r.id)).toEqual(['[REDACTED:column]', '[REDACTED:column]']);
  });

  it('scans every string when detection is on', () => {
    const { rows, counts } = redactRows(ROWS, COLUMNS, policy({ pii: true }));
    expect(rows[0]).toEqual({ id: 1, email: '[REDACTED:email]', notes: 'call [REDACTED:phone]' });
    expect(counts).toEqual({ email: 1, phone: 1 });
  });

  it('applies an allow list', () => {
    const { rows, counts } = redactRows(ROWS, COLUMNS, policy({ allowed: ['customers.id'] }));
    expect(rows[0]).toEqual({
      id: 1,
      email: '[REDACTED:not_allowed]',
      notes: '[REDACTED:not_allowed]',
    });
    expect(counts).toEqual({ not_allowed: 3 });
  });

  it('does not mutate its input', () => {
    const original = structuredClone(ROWS);
    redactRows(ROWS, COLUMNS, policy({ pii: true, columns: ['id'] }));
    expect(ROWS).toEqual(original);
  });
});

describe('error messages', () => {
  const POLICIES: Record<string, RedactionPolicy> = {
    none: NO_REDACTION,
    deny: policy({ columns: ['email'] }),
    pii: policy({ pii: true }),
    allow: policy({ allowed: ['customers.id'] }),
  };

  it.each(vectors.errors.map((c) => [c.message.slice(0, 40), c] as const))(
    'shared vector: %s',
    (_label, c) => {
      expect(redactError(c.message, POLICIES[c.policy], c.sqlstate ?? undefined)).toBe(c.output);
    }
  );
});

describe('review regressions', () => {
  it('scans JSON keys', () => {
    const counts: Counts = {};
    expect(redactValue({ 'ana@corp.es': 'owner' }, counts)).toEqual({
      '[REDACTED:email]': 'owner',
    });
    expect(counts).toEqual({ email: 1 });
  });

  it('does not accept a trailing newline in a column name', () => {
    expect(ruleMatches('id', 'id\n', null)).toBe(false);
  });

  it('masks a duplicated result name if any column carrying it must be', () => {
    const columns: ColumnMeta[] = [
      { name: 'id', source: ['public', 'customers', 'id'] },
      { name: 'id', source: ['public', 'customers', 'email'] },
    ];
    expect(Object.fromEntries(columnsToMask(columns, policy({ allowed: ['customers.id'] })))).toEqual(
      { id: '[REDACTED:not_allowed]' }
    );
  });
});



describe('configuration', () => {
  const KEYS = [
    'POSTGRES_CONNECTIONS',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'REDACT_PII',
    'REDACT_COLUMNS',
    'ALLOWED_COLUMNS',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.POSTGRES_USER = 'u';
    process.env.POSTGRES_PASSWORD = 'p';
    process.env.POSTGRES_DB = 'd';
    resetSettings();
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetSettings();
  });

  it('is off by default', () => {
    expect(resolveAlias().redaction).toEqual(NO_REDACTION);
  });

  it('reads the global variables', () => {
    process.env.REDACT_PII = 'true';
    process.env.REDACT_COLUMNS = 'Email, customers.phone';
    process.env.ALLOWED_COLUMNS = 'customers.*';
    expect(resolveAlias().redaction).toEqual({
      pii: true,
      columns: ['email', 'customers.phone'],
      allowed: ['customers.*'],
    });
  });

  it('lets connections inherit and override', () => {
    process.env.REDACT_PII = 'true';
    process.env.REDACT_COLUMNS = 'email';
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'inherits', url: 'postgresql://u:p@h/d' },
      {
        alias: 'overrides',
        url: 'postgresql://u:p@h/d',
        redactPii: false,
        redactColumns: ['ssn'],
        allowedColumns: ['public.orders.*'],
      },
    ]);
    expect(resolveAlias('inherits').redaction).toEqual({
      pii: true,
      columns: ['email'],
      allowed: [],
    });
    expect(resolveAlias('overrides').redaction).toEqual({
      pii: false,
      columns: ['ssn'],
      allowed: ['public.orders.*'],
    });
  });

  it.each([
    [{ redactPii: 'yes' }, /redactPii/],
    [{ redactColumns: 'a.b.c.d' }, /invalid rule/],
    [{ allowedColumns: [3] }, /allowedColumns/],
  ])('rejects invalid connection policy %j', (entry, message) => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'x', url: 'postgresql://u:p@h/d', ...entry },
    ]);
    expect(() => resolveAlias('x')).toThrow(message);
  });

  it('rejects an invalid global rule', () => {
    process.env.REDACT_COLUMNS = 'a.b.c.d';
    expect(() => resolveAlias()).toThrow(/REDACT_COLUMNS/);
  });

  // Same values pydantic accepts on the Python side; anything else is an error
  // rather than a silent "off", which would fail open.
  it.each(['1', 'on', 't', 'TRUE', 'y', 'Yes'])('reads REDACT_PII=%s as on', (value) => {
    process.env.REDACT_PII = value;
    expect(resolveAlias().redaction.pii).toBe(true);
  });

  it.each(['0', 'off', 'f', 'false', 'n', 'NO'])('reads REDACT_PII=%s as off', (value) => {
    process.env.REDACT_PII = value;
    expect(resolveAlias().redaction.pii).toBe(false);
  });

  it.each(['', 'maybe'])('rejects REDACT_PII=%j', (value) => {
    process.env.REDACT_PII = value;
    expect(() => resolveAlias()).toThrow(/REDACT_PII/);
  });

  it('lets a connection clear the global rules with null', () => {
    process.env.REDACT_COLUMNS = 'email';
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'x', url: 'postgresql://u:p@h/d', redactColumns: null },
    ]);
    expect(resolveAlias('x').redaction.columns).toEqual([]);
  });
});
