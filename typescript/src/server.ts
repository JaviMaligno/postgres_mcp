/**
 * MCP server wiring for the PostgreSQL server.
 *
 * Split out of index.ts so tests can build a server and drive it over an
 * in-memory transport without the entry point's side effects (settings
 * validation, process.exit, stdio connect).
 *
 * Speaks the 2026-07-28 protocol revision (SDK v2). The server is dual-era by
 * default: 2025-era clients that open with `initialize` are served exactly as
 * before, so upgrading here does not force anyone to upgrade their client.
 */

import { Server } from '@modelcontextprotocol/server';

import { toolDefinitions, handleToolCall } from './tools.js';
import { resourceDefinitions, handleResourceRead } from './resources.js';
import { promptDefinitions, handlePromptGet } from './prompts.js';

/** Keep in step with package.json — `version.test.ts` fails the build if it drifts. */
export const VERSION = '1.1.0';

export function createServer(): Server {
  const server = new Server(
    {
      name: 'postgres-mcp',
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // List available tools
  server.setRequestHandler('tools/list', async () => {
    return {
      tools: toolDefinitions,
    };
  });

  // Handle tool calls
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args || {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  // List available resources
  server.setRequestHandler('resources/list', async () => {
    return {
      resources: resourceDefinitions,
    };
  });

  // Handle resource reads
  server.setRequestHandler('resources/read', async (request) => {
    const { uri } = request.params;

    try {
      const content = await handleResourceRead(uri);
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: content,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to read resource: ${message}`);
    }
  });

  // List available prompts
  server.setRequestHandler('prompts/list', async () => {
    return {
      prompts: promptDefinitions,
    };
  });

  // Handle prompt gets
  server.setRequestHandler('prompts/get', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = handlePromptGet(name, args || {});
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get prompt: ${message}`);
    }
  });

  return server;
}
