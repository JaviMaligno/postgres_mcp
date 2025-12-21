/**
 * Settings management for PostgreSQL MCP Server
 * 
 * Configuration via environment variables:
 * - POSTGRES_HOST: Database host (default: localhost)
 * - POSTGRES_PORT: Database port (default: 5432)
 * - POSTGRES_USER: Database user (required)
 * - POSTGRES_PASSWORD: Database password (required)
 * - POSTGRES_DB: Database name (required)
 * - POSTGRES_SSLMODE: SSL mode (default: prefer)
 * - ALLOW_WRITE_OPERATIONS: Enable INSERT/UPDATE/DELETE (default: false)
 * - QUERY_TIMEOUT: Query timeout in seconds (default: 30)
 * - MAX_ROWS: Maximum rows returned per query (default: 1000)
 */

import { z } from 'zod';

const settingsSchema = z.object({
  postgresHost: z.string().default('localhost'),
  postgresPort: z.number().min(1).max(65535).default(5432),
  postgresUser: z.string().min(1, 'POSTGRES_USER is required'),
  postgresPassword: z.string().min(1, 'POSTGRES_PASSWORD is required'),
  postgresDb: z.string().min(1, 'POSTGRES_DB is required'),
  postgresSslmode: z.enum(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']).default('prefer'),
  allowWriteOperations: z.boolean().default(false),
  queryTimeout: z.number().min(1).max(300).default(30),
  maxRows: z.number().min(1).max(10000).default(1000),
});

export type Settings = z.infer<typeof settingsSchema>;

let cachedSettings: Settings | null = null;

/**
 * Load and validate settings from environment variables.
 * Results are cached for subsequent calls.
 */
export function getSettings(): Settings {
  if (cachedSettings) {
    return cachedSettings;
  }

  const rawSettings = {
    postgresHost: process.env.POSTGRES_HOST || 'localhost',
    postgresPort: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    postgresUser: process.env.POSTGRES_USER || '',
    postgresPassword: process.env.POSTGRES_PASSWORD || '',
    postgresDb: process.env.POSTGRES_DB || '',
    postgresSslmode: (process.env.POSTGRES_SSLMODE || 'prefer') as Settings['postgresSslmode'],
    allowWriteOperations: process.env.ALLOW_WRITE_OPERATIONS === 'true',
    queryTimeout: parseInt(process.env.QUERY_TIMEOUT || '30', 10),
    maxRows: parseInt(process.env.MAX_ROWS || '1000', 10),
  };

  const result = settingsSchema.safeParse(rawSettings);
  
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Configuration error: ${errors}`);
  }

  cachedSettings = result.data;
  return cachedSettings;
}

/**
 * Reset cached settings (useful for testing)
 */
export function resetSettings(): void {
  cachedSettings = null;
}

/**
 * Get PostgreSQL connection configuration
 */
export function getConnectionConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl?: { rejectUnauthorized: boolean };
  statement_timeout: number;
} {
  const settings = getSettings();
  
  const config: ReturnType<typeof getConnectionConfig> = {
    host: settings.postgresHost,
    port: settings.postgresPort,
    user: settings.postgresUser,
    password: settings.postgresPassword,
    database: settings.postgresDb,
    statement_timeout: settings.queryTimeout * 1000,
  };

  // Configure SSL based on sslmode
  if (settings.postgresSslmode !== 'disable') {
    config.ssl = {
      rejectUnauthorized: ['verify-ca', 'verify-full'].includes(settings.postgresSslmode),
    };
  }

  return config;
}

