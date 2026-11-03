/**
 * Security utilities for PostgreSQL MCP Server
 * 
 * Provides SQL validation, identifier sanitization, and injection prevention.
 */

/**
 * Error thrown when SQL validation fails
 */
export class SQLValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SQLValidationError';
  }
}

/**
 * Dangerous SQL patterns that should be blocked
 */
const DANGEROUS_PATTERNS = [
  /;\s*DROP\s+/i,
  /;\s*DELETE\s+/i,
  /;\s*TRUNCATE\s+/i,
  /;\s*ALTER\s+/i,
  /;\s*CREATE\s+/i,
  /;\s*GRANT\s+/i,
  /;\s*REVOKE\s+/i,
  /--.*$/gm,  // SQL comments
  /\/\*[\s\S]*?\*\//g,  // Block comments
  /xp_cmdshell/i,
  /exec\s*\(/i,
  /execute\s*\(/i,
];

/**
 * Statements that may start a query when writes are enabled.
 */
const WRITE_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE'];

/**
 * Words that make a query a write wherever they appear, matched as whole words
 * (so `updated_at` is fine). Checking only the first keyword let
 * `WITH u AS (UPDATE ...) SELECT 1` and `SELECT ... INTO new_table` write
 * with ALLOW_WRITE_OPERATIONS=false. Same list as python/postgres_mcp/security.py.
 */
const READ_ONLY_FORBIDDEN_WORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER', 'TRUNCATE', 'GRANT', 'REVOKE',
  'COPY', 'LOCK', 'VACUUM', 'REINDEX', 'CLUSTER', 'MERGE', 'INTO',
];

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

/**
 * Replace string literals and quoted identifiers with empty ones, so keyword
 * checks look at SQL only (WHERE action = 'UPDATE' is a read). Errs towards
 * seeing more SQL than PostgreSQL does, never less, and rejects unterminated
 * literals. Mirrors strip_literals in python/postgres_mcp/security.py.
 */
export function stripLiterals(query: string): string {
  let out = '';
  let i = 0;
  const n = query.length;
  while (i < n) {
    const char = query[i];
    const prevIsIdent = i > 0 && IDENT_CHAR.test(query[i - 1]);
    if (char === "'") {
      // E'...' (not part of a longer word) is the only form where a backslash
      // escapes the next character.
      const escapes =
        i > 0 && (query[i - 1] === 'E' || query[i - 1] === 'e') &&
        !(i > 1 && IDENT_CHAR.test(query[i - 2]));
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new SQLValidationError('Unterminated string literal');
        if (escapes && query[j] === '\\') {
          j += 2;
          continue;
        }
        if (query[j] === "'") {
          if (j + 1 < n && query[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += "''";
      i = j + 1;
    } else if (char === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new SQLValidationError('Unterminated quoted identifier');
        if (query[j] === '"') {
          if (j + 1 < n && query[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      out += '""';
      i = j + 1;
    } else if (char === '$' && !prevIsIdent) {
      DOLLAR_TAG.lastIndex = i;
      const opener = DOLLAR_TAG.exec(query);
      if (!opener) {
        out += char;
        i += 1;
        continue;
      }
      const tag = opener[0];
      const end = query.indexOf(tag, i + tag.length);
      if (end < 0) throw new SQLValidationError('Unterminated dollar-quoted string');
      out += "''";
      i = end + tag.length;
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

/**
 * Validate a SQL query for safety
 * 
 * @param query - SQL query to validate
 * @param allowWrite - Whether to allow write operations
 * @returns The validated query (trimmed)
 * @throws SQLValidationError if validation fails
 */
export function validateQuery(query: string, allowWrite: boolean = false): string {
  if (!query || typeof query !== 'string') {
    throw new SQLValidationError('Query must be a non-empty string');
  }

  const trimmedQuery = query.trim();

  // Check for dangerous patterns. Reset lastIndex: two of them carry the g
  // flag, and test() on a global regex resumes from the previous match, so
  // every other call used to skip the check.
  for (const pattern of DANGEROUS_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(trimmedQuery)) {
      throw new SQLValidationError('Query contains potentially dangerous patterns');
    }
  }

  // The statement and keyword checks look at SQL only, not at the contents of
  // literals: WHERE action = 'UPDATE' or LIKE '%;%' is a read.
  const sqlOnly = stripLiterals(trimmedQuery);

  // One statement only: "SELECT 1; COMMIT; UPDATE ..." would otherwise run
  // all three. A trailing semicolon is fine.
  if (sqlOnly.replace(/[;\s]+$/, '').includes(';')) {
    throw new SQLValidationError('Multiple SQL statements are not allowed');
  }

  // Check for write operations if not allowed
  if (!allowWrite) {
    const upperQuery = sqlOnly.toUpperCase();
    for (const keyword of READ_ONLY_FORBIDDEN_WORDS) {
      if (new RegExp(`\\b${keyword}\\b`).test(upperQuery)) {
        throw new SQLValidationError(
          `Write operation '${keyword}' is not allowed. Set ALLOW_WRITE_OPERATIONS=true to enable.`
        );
      }
    }
  }

  // Basic validation - must start with a valid SQL keyword
  const validStartKeywords = ['SELECT', 'WITH', 'EXPLAIN', 'SHOW', 'DESCRIBE', 'SET'];
  if (allowWrite) {
    validStartKeywords.push(...WRITE_KEYWORDS);
  }

  const startsWithValid = validStartKeywords.some(keyword =>
    trimmedQuery.toUpperCase().startsWith(keyword)
  );

  if (!startsWithValid) {
    throw new SQLValidationError(
      `Query must start with one of: ${validStartKeywords.join(', ')}`
    );
  }

  return trimmedQuery;
}

/**
 * Validate a PostgreSQL identifier (schema, table, column name)
 * 
 * @param identifier - Identifier to validate
 * @returns true if valid
 * @throws SQLValidationError if invalid
 */
export function validateIdentifier(identifier: string): boolean {
  if (!identifier || typeof identifier !== 'string') {
    throw new SQLValidationError('Identifier must be a non-empty string');
  }

  // PostgreSQL identifier rules:
  // - Must start with a letter or underscore
  // - Can contain letters, digits, underscores, dollar signs
  // - Max length 63 characters
  const identifierPattern = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
  
  if (!identifierPattern.test(identifier)) {
    throw new SQLValidationError(
      `Invalid identifier '${identifier}'. Must start with a letter or underscore and contain only letters, digits, underscores, or dollar signs.`
    );
  }

  if (identifier.length > 63) {
    throw new SQLValidationError(
      `Identifier '${identifier}' exceeds maximum length of 63 characters`
    );
  }

  return true;
}

/**
 * Sanitize a limit parameter
 * 
 * @param limit - Limit value to sanitize
 * @param maxLimit - Maximum allowed limit
 * @returns Sanitized limit value
 */
export function sanitizeLimit(limit: number | undefined, maxLimit: number = 1000): number {
  if (limit === undefined || limit === null) {
    return maxLimit;
  }
  
  const numLimit = Math.floor(Number(limit));
  
  if (isNaN(numLimit) || numLimit < 1) {
    return 1;
  }
  
  return Math.min(numLimit, maxLimit);
}

/**
 * Escape a string for safe use in LIKE patterns
 * 
 * @param value - Value to escape
 * @returns Escaped value
 */
export function escapeLikePattern(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

