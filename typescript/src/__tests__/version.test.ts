/**
 * The version the server reports over MCP and the version npm publishes have to
 * be the same number. They had drifted three ways (package.json 0.2.0, the
 * server constant 0.10.0, npm 1.0.1), which makes a bug report impossible to
 * place against a release. This test is the thing that keeps them together.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { VERSION } from '../server.js';

const packageJsonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../package.json'
);

describe('version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };

    expect(VERSION).toBe(pkg.version);
  });
});
