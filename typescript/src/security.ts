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
 * Write operation keywords
 */
const WRITE_KEYWORDS = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE'];

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

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmedQuery)) {
      throw new SQLValidationError('Query contains potentially dangerous patterns');
    }
  }

  // Check for write operations if not allowed
  if (!allowWrite) {
    const upperQuery = trimmedQuery.toUpperCase();
    for (const keyword of WRITE_KEYWORDS) {
      if (upperQuery.startsWith(keyword) || new RegExp(`^\\s*${keyword}\\s`, 'i').test(trimmedQuery)) {
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

