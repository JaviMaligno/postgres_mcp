/**
 * Read-only validation, against the corpus the Python suite also runs
 * (testdata/readonly_vectors.json), so both servers refuse the same queries.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { validateQuery } from '../security.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(
  readFileSync(resolve(here, '../../../testdata/readonly_vectors.json'), 'utf-8')
) as { reject: string[]; allow: string[] };

const fuzz = JSON.parse(
  readFileSync(resolve(here, '../../../testdata/readonly_fuzz.json'), 'utf-8')
) as { accepted: string[]; rejected: string[] };

describe('read-only validation', () => {
  it('reaches the same verdicts as Python on 1,015 generated queries', () => {
    for (const query of fuzz.accepted) expect(() => validateQuery(query, false)).not.toThrow();
    for (const query of fuzz.rejected) expect(() => validateQuery(query, false)).toThrow();
  });

  it.each(vectors.reject)('rejects %s', (query) => {
    expect(() => validateQuery(query, false)).toThrow();
  });

  it.each(vectors.allow)('allows %s', (query) => {
    expect(validateQuery(query, false)).toBe(query.trim());
  });

  it('checks comments on every call, not every other one', () => {
    // The comment patterns are global regexes; test() used to resume from the
    // previous match's lastIndex and skip the check on alternate calls.
    for (let i = 0; i < 4; i++) {
      expect(() => validateQuery('SELECT 1 -- x', false)).toThrow();
    }
  });
});
