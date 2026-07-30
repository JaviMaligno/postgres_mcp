/**
 * Settings management for PostgreSQL MCP Server
 *
 * Global configuration via environment variables:
 * - QUERY_TIMEOUT: Query timeout in seconds (default: 30)
 * - MAX_ROWS: Maximum rows returned per query (default: 1000)
 * - ALLOW_WRITE_OPERATIONS: Default write permission for connections that do
 *   not state their own (default: false)
 *
 * Connections come in one of two shapes.
 *
 * **One database** (unchanged, and still the simplest thing that works):
 * - POSTGRES_HOST (default: localhost), POSTGRES_PORT (default: 5432),
 *   POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, POSTGRES_SSLMODE
 *   (default: prefer). Available under the alias `default`.
 *
 * **Several databases**, via POSTGRES_CONNECTIONS holding a JSON array:
 *
 *   POSTGRES_CONNECTIONS='[
 *     {"alias":"local","host":"localhost","user":"me","password":"…","database":"app","allowWrite":true},
 *     {"alias":"analytics","url":"postgresql://reader:…@warehouse:6543/metrics","default":true}
 *   ]'
 *
 * The two forms are mutually exclusive: when POSTGRES_CONNECTIONS is set the
 * POSTGRES_* variables are ignored, so there is never a question of which one
 * won.
 *
 * Credentials live here and only here. Tools accept an optional `database`
 * argument naming an alias — never a host, user or password, which would put
 * secrets in the conversation.
 */

import { z } from 'zod';

/** Alias used when a single database is configured the old way. */
export const DEFAULT_ALIAS = 'default';

const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'] as const;

const globalSettingsSchema = z.object({
  allowWriteOperations: z.boolean().default(false),
  queryTimeout: z.number().min(1).max(300).default(30),
  maxRows: z.number().min(1).max(10000).default(1000),
});

/** One entry of POSTGRES_CONNECTIONS. Either `url` or the discrete fields. */
const connectionInputSchema = z
  .object({
    alias: z.string().min(1, 'alias is required').regex(
      /^[A-Za-z0-9_-]+$/,
      'alias may only contain letters, digits, hyphens and underscores'
    ),
    url: z.string().min(1).optional(),
    host: z.string().min(1).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    user: z.string().min(1).optional(),
    password: z.string().optional(),
    database: z.string().min(1).optional(),
    sslmode: z.enum(SSL_MODES).optional(),
    /** Overrides ALLOW_WRITE_OPERATIONS for this connection only. */
    allowWrite: z.boolean().optional(),
    /** Marks the connection used when a tool call omits `database`. */
    default: z.boolean().optional(),
  })
  .refine((c) => c.url !== undefined || (c.user !== undefined && c.database !== undefined), {
    message: 'each connection needs either "url" or both "user" and "database"',
  });

/** A resolved connection: everything needed to open a pool. */
export interface Connection {
  alias: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslmode: (typeof SSL_MODES)[number];
  allowWrite: boolean;
  isDefault: boolean;
}

/** The safe-to-share view of a connection: no credentials. */
export interface ConnectionSummary {
  alias: string;
  host: string;
  port: number;
  database: string;
  allowWrite: boolean;
  isDefault: boolean;
}

export type Settings = z.infer<typeof globalSettingsSchema>;

let cachedSettings: Settings | null = null;
let cachedConnections: Connection[] | null = null;

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Load and validate the global (non-connection) settings.
 * Results are cached for subsequent calls.
 */
export function getSettings(): Settings {
  if (cachedSettings) {
    return cachedSettings;
  }

  const result = globalSettingsSchema.safeParse({
    allowWriteOperations: process.env.ALLOW_WRITE_OPERATIONS === 'true',
    queryTimeout: parseIntEnv(process.env.QUERY_TIMEOUT, 30),
    maxRows: parseIntEnv(process.env.MAX_ROWS, 1000),
  });

  if (!result.success) {
    // zod v4 renamed ZodError.errors to .issues (v3's alias is gone).
    const errors = result.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Configuration error: ${errors}`);
  }

  cachedSettings = result.data;

  // Connections are validated here too, so a bad configuration is reported at
  // startup (index.ts calls getSettings()) rather than on the first tool call.
  listConnections();

  return cachedSettings;
}

/** Splits a postgres:// DSN into the fields a pool needs. */
function fromUrl(alias: string, url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Configuration error: connection "${alias}" has an unparseable url`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `Configuration error: connection "${alias}" must use a postgres:// or postgresql:// url, got "${parsed.protocol}//"`
    );
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error(`Configuration error: connection "${alias}" url has no database name`);
  }

  const sslmode = parsed.searchParams.get('sslmode') ?? undefined;
  if (sslmode !== undefined && !SSL_MODES.includes(sslmode as (typeof SSL_MODES)[number])) {
    throw new Error(`Configuration error: connection "${alias}" has an unknown sslmode "${sslmode}"`);
  }

  return {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? parseInt(parsed.port, 10) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslmode: sslmode as (typeof SSL_MODES)[number] | undefined,
  };
}

/** Builds the single connection implied by the POSTGRES_* variables. */
function singleConnectionFromEnv(defaultAllowWrite: boolean): Connection {
  const schema = z.object({
    host: z.string().default('localhost'),
    port: z.number().min(1).max(65535).default(5432),
    user: z.string().min(1, 'POSTGRES_USER is required'),
    password: z.string().min(1, 'POSTGRES_PASSWORD is required'),
    database: z.string().min(1, 'POSTGRES_DB is required'),
    sslmode: z.enum(SSL_MODES).default('prefer'),
  });

  const result = schema.safeParse({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseIntEnv(process.env.POSTGRES_PORT, 5432),
    user: process.env.POSTGRES_USER || '',
    password: process.env.POSTGRES_PASSWORD || '',
    database: process.env.POSTGRES_DB || '',
    sslmode: (process.env.POSTGRES_SSLMODE || 'prefer') as (typeof SSL_MODES)[number],
  });

  if (!result.success) {
    const errors = result.error.issues.map((e) => e.message).join(', ');
    throw new Error(`Configuration error: ${errors}`);
  }

  return {
    alias: DEFAULT_ALIAS,
    ...result.data,
    allowWrite: defaultAllowWrite,
    isDefault: true,
  };
}

/** Parses POSTGRES_CONNECTIONS into resolved connections. */
function connectionsFromJson(raw: string, defaultAllowWrite: boolean): Connection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Configuration error: POSTGRES_CONNECTIONS is not valid JSON');
  }

  const result = z.array(connectionInputSchema).safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues
      .map((e) => `${['POSTGRES_CONNECTIONS', ...e.path].join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Configuration error: ${errors}`);
  }
  if (result.data.length === 0) {
    throw new Error('Configuration error: POSTGRES_CONNECTIONS is empty — declare at least one connection');
  }

  const seen = new Set<string>();
  for (const entry of result.data) {
    if (seen.has(entry.alias)) {
      throw new Error(`Configuration error: duplicate connection alias "${entry.alias}"`);
    }
    seen.add(entry.alias);
  }

  // Exactly one explicit default is allowed; otherwise the first declaration wins.
  const explicitDefaults = result.data.filter((c) => c.default === true);
  if (explicitDefaults.length > 1) {
    const aliases = explicitDefaults.map((c) => c.alias).join(', ');
    throw new Error(`Configuration error: more than one default connection: ${aliases}`);
  }
  const defaultAlias = (explicitDefaults[0] ?? result.data[0]).alias;

  return result.data.map((entry) => {
    const fromDsn = entry.url ? fromUrl(entry.alias, entry.url) : undefined;

    // Discrete fields win over the DSN, so a url can be overridden field by field.
    const host = entry.host ?? fromDsn?.host ?? 'localhost';
    const port = entry.port ?? fromDsn?.port ?? 5432;
    const user = entry.user ?? fromDsn?.user ?? '';
    const password = entry.password ?? fromDsn?.password ?? '';
    const database = entry.database ?? fromDsn?.database ?? '';
    const sslmode = entry.sslmode ?? fromDsn?.sslmode ?? 'prefer';

    if (!user || !database) {
      throw new Error(
        `Configuration error: connection "${entry.alias}" is missing a user or a database name`
      );
    }

    return {
      alias: entry.alias,
      host,
      port,
      user,
      password,
      database,
      sslmode,
      allowWrite: entry.allowWrite ?? defaultAllowWrite,
      isDefault: entry.alias === defaultAlias,
    };
  });
}

/** Every configured connection, credentials included. Internal use only. */
function getConnections(): Connection[] {
  if (cachedConnections) {
    return cachedConnections;
  }

  const defaultAllowWrite = process.env.ALLOW_WRITE_OPERATIONS === 'true';
  const raw = process.env.POSTGRES_CONNECTIONS;

  cachedConnections = raw
    ? connectionsFromJson(raw, defaultAllowWrite)
    : [singleConnectionFromEnv(defaultAllowWrite)];

  return cachedConnections;
}

/**
 * The connections, without credentials — safe to return from a tool.
 */
export function listConnections(): ConnectionSummary[] {
  return getConnections().map(({ alias, host, port, database, allowWrite, isDefault }) => ({
    alias,
    host,
    port,
    database,
    allowWrite,
    isDefault,
  }));
}

/**
 * Resolve an alias to its connection. An omitted alias gives the default one.
 *
 * The error names the alias asked for *and* lists the valid ones: this message
 * is what the model reads when it guesses wrong, and it needs both halves to
 * recover on its own.
 */
export function resolveAlias(alias?: string): Connection {
  const connections = getConnections();

  if (alias === undefined || alias === '') {
    const fallback = connections.find((c) => c.isDefault) ?? connections[0];
    return fallback;
  }

  const found = connections.find((c) => c.alias === alias);
  if (!found) {
    const available = connections.map((c) => c.alias).join(', ');
    throw new Error(`Unknown database "${alias}". Configured connections: ${available}`);
  }

  return found;
}

/**
 * Reset cached settings (useful for testing)
 */
export function resetSettings(): void {
  cachedSettings = null;
  cachedConnections = null;
}

/**
 * Get the PostgreSQL connection configuration for an alias (default when omitted).
 */
export function getConnectionConfig(alias?: string): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: { rejectUnauthorized: boolean };
  statement_timeout: number;
} {
  const connection = resolveAlias(alias);
  const settings = getSettings();

  const config: ReturnType<typeof getConnectionConfig> = {
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    statement_timeout: settings.queryTimeout * 1000,
  };

  // Configure SSL based on sslmode
  if (connection.sslmode !== 'disable') {
    config.ssl = {
      rejectUnauthorized: ['verify-ca', 'verify-full'].includes(connection.sslmode),
    };
  }

  return config;
}
