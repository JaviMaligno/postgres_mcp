#!/usr/bin/env node
/**
 * PostgreSQL MCP Server - TypeScript Implementation
 *
 * Provides tools for interacting with PostgreSQL databases,
 * including querying, schema exploration, and table management.
 *
 * Entry point only: the server wiring lives in server.ts so it can be tested
 * without these side effects.
 */

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { getSettings } from './settings.js';
import { createServer, VERSION } from './server.js';

async function main(): Promise<void> {
  // Validate settings on startup (but don't fail if DB is not available)
  try {
    getSettings();
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log to stderr so it doesn't interfere with MCP communication on stdout
  console.error(`PostgreSQL MCP Server v${VERSION} started`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
