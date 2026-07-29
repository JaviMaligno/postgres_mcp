/**
 * Multi-connection configuration.
 *
 * The server used to be pinned to one database, fixed at startup by
 * POSTGRES_* environment variables. These tests specify the named-connection
 * behaviour: several databases declared in the environment, selected per call
 * by alias, with the single-database setup still working untouched.
 *
 * The security property under test throughout: credentials only ever come from
 * the environment. A tool argument can name an alias; it can never carry a
 * host, a user or a password.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  getSettings,
  resetSettings,
  getConnectionConfig,
  listConnections,
  resolveAlias,
  DEFAULT_ALIAS,
} from '../settings.js';
import { handleToolCall } from '../tools.js';
import { resetClient } from '../client.js';

const POSTGRES_ENV = [
  'POSTGRES_CONNECTIONS',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'POSTGRES_SSLMODE',
  'ALLOW_WRITE_OPERATIONS',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(POSTGRES_ENV.map((k) => [k, process.env[k]]));
  for (const k of POSTGRES_ENV) delete process.env[k];
  resetSettings();
  // Pools are keyed by alias and cached, so they must go too or a later test
  // reuses a client built from an earlier test's environment.
  resetClient();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetSettings();
  resetClient();
});

/** The configuration everyone already has: one database, no aliases. */
function singleDatabaseEnv() {
  process.env.POSTGRES_HOST = 'localhost';
  process.env.POSTGRES_USER = 'me';
  process.env.POSTGRES_PASSWORD = 'secret';
  process.env.POSTGRES_DB = 'app';
}

describe('single-database configuration (backwards compatibility)', () => {
  it('exposes exactly one connection, under the default alias', () => {
    singleDatabaseEnv();

    const connections = listConnections();

    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      alias: DEFAULT_ALIAS,
      host: 'localhost',
      database: 'app',
      isDefault: true,
    });
  });

  it('never exposes credentials when listing connections', () => {
    singleDatabaseEnv();

    const serialised = JSON.stringify(listConnections());

    expect(serialised).not.toContain('secret');
    expect(serialised).not.toContain('password');
  });

  it('resolves an omitted alias to the default connection', () => {
    singleDatabaseEnv();

    expect(resolveAlias(undefined).alias).toBe(DEFAULT_ALIAS);
    expect(getConnectionConfig(undefined).database).toBe('app');
  });

  it('still requires user, password and database', () => {
    process.env.POSTGRES_HOST = 'localhost';

    expect(() => getSettings()).toThrow(/POSTGRES_USER/);
  });
});

describe('multiple named connections', () => {
  function multiEnv() {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'local', host: 'localhost', user: 'me', password: 'localpw', database: 'app' },
      {
        alias: 'analytics',
        host: 'warehouse.example.com',
        port: 6543,
        user: 'reader',
        password: 'analyticspw',
        database: 'metrics',
        sslmode: 'require',
        allowWrite: false,
      },
      {
        alias: 'scratch',
        host: 'localhost',
        user: 'me',
        password: 'scratchpw',
        database: 'scratch',
        allowWrite: true,
        default: true,
      },
    ]);
  }

  it('lists every configured alias', () => {
    multiEnv();

    expect(listConnections().map((c) => c.alias)).toEqual(['local', 'analytics', 'scratch']);
  });

  it('honours an explicit default over declaration order', () => {
    multiEnv();

    expect(resolveAlias(undefined).alias).toBe('scratch');
    expect(listConnections().filter((c) => c.isDefault).map((c) => c.alias)).toEqual(['scratch']);
  });

  it('rejects more than one explicit default', () => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'first', user: 'a', password: 'b', database: 'c', default: true },
      { alias: 'second', user: 'a', password: 'b', database: 'c', default: true },
    ]);

    expect(() => listConnections()).toThrow(/default.*first.*second/s);
  });

  it('falls back to the first connection when none is marked default', () => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'first', user: 'a', password: 'b', database: 'c' },
      { alias: 'second', user: 'a', password: 'b', database: 'c' },
    ]);

    expect(resolveAlias(undefined).alias).toBe('first');
  });

  it('builds the right connection config per alias', () => {
    multiEnv();

    expect(getConnectionConfig('analytics')).toMatchObject({
      host: 'warehouse.example.com',
      port: 6543,
      user: 'reader',
      password: 'analyticspw',
      database: 'metrics',
    });
    expect(getConnectionConfig('local')).toMatchObject({ database: 'app', port: 5432 });
  });

  it('carries write permission per connection', () => {
    multiEnv();

    expect(resolveAlias('scratch').allowWrite).toBe(true);
    expect(resolveAlias('analytics').allowWrite).toBe(false);
    // Not stated: inherits the global default, which is read-only.
    expect(resolveAlias('local').allowWrite).toBe(false);
  });

  it('lets ALLOW_WRITE_OPERATIONS set the default for connections that omit it', () => {
    process.env.ALLOW_WRITE_OPERATIONS = 'true';
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'a', user: 'u', password: 'p', database: 'd' },
      { alias: 'b', user: 'u', password: 'p', database: 'd', allowWrite: false },
    ]);

    expect(resolveAlias('a').allowWrite).toBe(true);
    expect(resolveAlias('b').allowWrite).toBe(false);
  });

  it('never exposes credentials when listing connections', () => {
    multiEnv();

    const serialised = JSON.stringify(listConnections());

    for (const secret of ['localpw', 'analyticspw', 'scratchpw']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('reports the alias and the valid ones when an unknown alias is asked for', () => {
    multiEnv();

    // The message is what the model reads to recover, so both halves matter.
    expect(() => resolveAlias('typo')).toThrow(/typo/);
    expect(() => resolveAlias('typo')).toThrow(/local.*analytics.*scratch/s);
  });

  it('rejects duplicate aliases instead of silently shadowing one', () => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'dup', user: 'u', password: 'p', database: 'd1' },
      { alias: 'dup', user: 'u', password: 'p', database: 'd2' },
    ]);

    expect(() => listConnections()).toThrow(/dup/);
  });

  it('rejects malformed JSON with a message naming the variable', () => {
    process.env.POSTGRES_CONNECTIONS = '{not json';

    expect(() => listConnections()).toThrow(/POSTGRES_CONNECTIONS/);
  });

  it('rejects a connection missing required fields', () => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([{ alias: 'broken', user: 'u' }]);

    expect(() => listConnections()).toThrow();
  });

  it('rejects an empty connection list', () => {
    process.env.POSTGRES_CONNECTIONS = '[]';

    expect(() => listConnections()).toThrow(/POSTGRES_CONNECTIONS/);
  });
});

describe('the list_databases tool', () => {
  beforeEach(() => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'local', host: 'localhost', user: 'me', password: 'localpw', database: 'app', allowWrite: true },
      { alias: 'prod', host: 'db.example.com', user: 'reader', password: 'prodpw', database: 'main', default: true },
    ]);
    resetSettings();
  });

  it('answers without opening a connection', async () => {
    // No database is reachable in this test, which is the point: the tool has to
    // work when the configured servers are down.
    const result = (await handleToolCall('list_databases', {})) as {
      connections: Array<{ alias: string; allowWrite: boolean }>;
      default: string;
    };

    expect(result.connections.map((c) => c.alias)).toEqual(['local', 'prod']);
    expect(result.default).toBe('prod');
    expect(result.connections.find((c) => c.alias === 'local')?.allowWrite).toBe(true);
  });

  it('does not return credentials', async () => {
    const serialised = JSON.stringify(await handleToolCall('list_databases', {}));

    expect(serialised).not.toContain('localpw');
    expect(serialised).not.toContain('prodpw');
  });

  it('rejects an unknown alias with a message the model can act on', async () => {
    await expect(handleToolCall('list_schemas', { database: 'staging' })).rejects.toThrow(
      /staging.*local.*prod/s
    );
  });
});

describe('connection URLs', () => {
  const dsnPassword = ['dsn', 'pw'].join('');
  const dsn = `postgresql://dsnuser:${dsnPassword}@db.example.com:6000/warehouse`;

  it('accepts a DSN instead of discrete fields', () => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([{ alias: 'remote', url: dsn }]);

    expect(getConnectionConfig('remote')).toMatchObject({
      host: 'db.example.com',
      port: 6000,
      user: 'dsnuser',
      password: dsnPassword,
      database: 'warehouse',
    });
  });

  it('does not leak the DSN password through the listing', () => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([{ alias: 'remote', url: dsn }]);

    expect(JSON.stringify(listConnections())).not.toContain(dsnPassword);
  });

  it('rejects a URL that is not postgres', () => {
    process.env.POSTGRES_CONNECTIONS = JSON.stringify([
      { alias: 'bad', url: 'https://example.com/db' },
    ]);

    expect(() => listConnections()).toThrow(/postgres/i);
  });
});
