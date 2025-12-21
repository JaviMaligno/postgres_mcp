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
 *   # Run as HTTP server (for Smithery)
 *   node dist/index.js --http
 *   node dist/index.js --http --port 8080
 */

import { createServer as createHttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
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
 * Run server in stdio mode (for Claude Desktop/Code)
 */
async function runStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  
  await server.connect(transport);
  
  console.error(`PostgreSQL MCP Server v${VERSION} started (stdio mode)`);
}

/**
 * Run server in HTTP mode (for Smithery)
 */
async function runHttpServer(port: number): Promise<void> {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
  });
  
  await server.connect(transport);
  
  const httpServer = createHttpServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
      });
      res.end();
      return;
    }
    
    // Add CORS headers to all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Handle MCP requests
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling request:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });
  
  httpServer.listen(port, () => {
    console.log(`PostgreSQL MCP Server v${VERSION} listening on http://0.0.0.0:${port} (HTTP mode)`);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    httpServer.close();
    await transport.close();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    httpServer.close();
    await transport.close();
    process.exit(0);
  });
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Validate settings on startup (only fail in stdio mode without env vars)
  const args = process.argv.slice(2);
  const isHttpMode = args.includes('--http');
  const portIndex = args.indexOf('--port');
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1], 10) : 8080;
  
  // In HTTP mode, settings validation happens per-request
  // In stdio mode, validate immediately
  if (!isHttpMode) {
    try {
      getSettings();
    } catch (error) {
      console.error('Configuration error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
  
  if (isHttpMode) {
    await runHttpServer(port);
  } else {
    await runStdioServer();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
