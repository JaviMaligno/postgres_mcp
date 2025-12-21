#!/usr/bin/env node
/**
 * PostgreSQL MCP Server - TypeScript Implementation
 * 
 * Provides tools for interacting with PostgreSQL databases,
 * including querying, schema exploration, and table management.
 * 
 * Usage:
 *   # Run as stdio server (for Claude Desktop/Code)
 *   node dist/index.js
 * 
 *   # Or via npm script
 *   npm start
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { getSettings } from './settings.js';
import { toolDefinitions, handleToolCall } from './tools.js';
import { resourceDefinitions, handleResourceRead } from './resources.js';
import { promptDefinitions, handlePromptGet } from './prompts.js';

const VERSION = '0.2.0';

/**
 * Create and configure the MCP server
 */
function createServer(): Server {
  const server = new Server(
    {
      name: 'postgres',
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
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions,
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: resourceDefinitions,
    };
  });

  // Read resource content
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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
  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: promptDefinitions,
    };
  });

  // Get prompt content
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
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

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Validate settings on startup
  try {
    getSettings();
  } catch (error) {
    console.error('Configuration error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  const server = createServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  
  console.error(`PostgreSQL MCP Server v${VERSION} started`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

