"""Security utilities for PostgreSQL MCP Server.

Provides SQL injection prevention, query validation, and identifier sanitization.
"""

from __future__ import annotations

import re

from psycopg2 import sql


# Keywords that indicate write operations - blocked in read-only mode
WRITE_KEYWORDS = frozenset(
    [
        "INSERT",
        "UPDATE",
        "DELETE",
        "DROP",
        "CREATE",
        "ALTER",
        "TRUNCATE",
        "GRANT",
        "REVOKE",
        "COPY",
        "LOCK",
        "VACUUM",
        "REINDEX",
        "CLUSTER",
        # MERGE writes and was missing; INTO covers SELECT ... INTO new_table.
        "MERGE",
        "INTO",
    ]
)

# Statements that can write and only appear at the start of a query. Matching
# them anywhere would reject text such as 'to do'. DO runs arbitrary code
# (EXECUTE 'UPD' || 'ATE ...' gets past any keyword list), CALL a procedure.
WRITE_STATEMENTS = ("DO", "CALL")

# Keywords that are always dangerous and should never be allowed
DANGEROUS_KEYWORDS = frozenset(
    [
        "DROP DATABASE",
        "DROP SCHEMA",
        "DROP OWNED",
        "DROP ROLE",
        "CREATE ROLE",
        "CREATE USER",
        "ALTER ROLE",
        "ALTER USER",
    ]
)

# Maximum query length to prevent DoS
MAX_QUERY_LENGTH = 100_000


class SQLValidationError(Exception):
    """Raised when SQL validation fails."""

    pass


_IDENT_CHAR = re.compile(r"[A-Za-z0-9_$]")
_DOLLAR_TAG = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")


def strip_literals(query: str) -> str:
    """Replace string literals and quoted identifiers with empty ones.

    Keyword checks then look at SQL only: WHERE action = 'UPDATE' is a read.
    The scan errs towards seeing *more* SQL than PostgreSQL does, never less:
    a plain '...' treats backslashes as ordinary characters (PostgreSQL's
    default; with standard_conforming_strings off the server would extend
    the string further, which only hides less), and an unterminated literal
    is rejected. Mirrored in typescript/src/security.ts.
    """
    out = []
    i, n = 0, len(query)
    while i < n:
        char = query[i]
        prev_is_ident = i > 0 and bool(_IDENT_CHAR.match(query[i - 1]))
        if char == "'":
            # E'...' (not part of a longer word) is the only form where a
            # backslash escapes the next character.
            escapes = (
                i > 0
                and query[i - 1] in "Ee"
                and not (i > 1 and _IDENT_CHAR.match(query[i - 2]))
            )
            j = i + 1
            while True:
                if j >= n:
                    raise SQLValidationError("Unterminated string literal")
                if escapes and query[j] == "\\":
                    j += 2
                    continue
                if query[j] == "'":
                    if j + 1 < n and query[j + 1] == "'":
                        j += 2
                        continue
                    break
                j += 1
            out.append("''")
            i = j + 1
        elif char == '"':
            j = i + 1
            while True:
                if j >= n:
                    raise SQLValidationError("Unterminated quoted identifier")
                if query[j] == '"':
                    if j + 1 < n and query[j + 1] == '"':
                        j += 2
                        continue
                    break
                j += 1
            out.append('""')
            i = j + 1
        elif char == "$" and not prev_is_ident and _DOLLAR_TAG.match(query, i):
            tag = _DOLLAR_TAG.match(query, i).group(0)
            end = query.find(tag, i + len(tag))
            if end < 0:
                raise SQLValidationError("Unterminated dollar-quoted string")
            out.append("''")
            i = end + len(tag)
        else:
            out.append(char)
            i += 1
    return "".join(out)


def validate_query(
    query: str,
    allow_write: bool = False,
    max_length: int = MAX_QUERY_LENGTH,
) -> str:
    """Validate and sanitize an SQL query.

    Args:
        query: SQL query string to validate
        allow_write: Whether to allow write operations (INSERT, UPDATE, DELETE, etc.)
        max_length: Maximum allowed query length

    Returns:
        The validated query string (stripped)

    Raises:
        SQLValidationError: If the query fails validation

    Examples:
        >>> validate_query("SELECT * FROM users")
        'SELECT * FROM users'
        >>> validate_query("DROP TABLE users")  # raises SQLValidationError
    """
    if not query or not query.strip():
        raise SQLValidationError("Query cannot be empty")

    query = query.strip()

    # Check query length
    if len(query) > max_length:
        raise SQLValidationError(
            f"Query exceeds maximum length of {max_length} characters"
        )

    # Normalize for keyword checking
    query_upper = query.upper()

    # Check for absolutely dangerous operations (never allowed)
    for dangerous in DANGEROUS_KEYWORDS:
        if dangerous in query_upper:
            raise SQLValidationError(f"Operation '{dangerous}' is not allowed")

    # The statement and keyword checks look at SQL only, not at the contents of
    # literals: WHERE action = 'UPDATE' or LIKE '%;%' is a read.
    sql_only = strip_literals(query)

    # Check for multiple statements (prevent SQL injection via statement chaining)
    # Remove the trailing semicolon if present, then check for others
    if ";" in re.sub(r"[;\s]+$", "", sql_only):
        raise SQLValidationError("Multiple SQL statements are not allowed")

    # Check for write operations if not allowed
    if not allow_write:
        first_word = re.match(r"[A-Z]+", query_upper)
        if first_word and first_word.group(0) in WRITE_STATEMENTS:
            raise SQLValidationError(
                f"Write operation '{first_word.group(0)}' is not allowed in "
                "read-only mode. Use the 'execute' tool for write operations."
            )
        for keyword in WRITE_KEYWORDS:
            # Use word boundary to avoid false positives (e.g., "UPDATED_AT" column)
            pattern = rf"\b{keyword}\b"
            if re.search(pattern, sql_only.upper()):
                raise SQLValidationError(
                    f"Write operation '{keyword}' is not allowed in read-only mode. "
                    "Use the 'execute' tool for write operations."
                )

    # Check for comment injection attempts
    if "--" in query or "/*" in query:
        raise SQLValidationError("SQL comments are not allowed")

    return query


def validate_identifier(identifier: str, max_length: int = 63) -> str:
    """Validate a PostgreSQL identifier (schema, table, column name).

    Args:
        identifier: The identifier to validate
        max_length: Maximum length (PostgreSQL default is 63)

    Returns:
        The validated identifier

    Raises:
        SQLValidationError: If the identifier is invalid

    Examples:
        >>> validate_identifier("users")
        'users'
        >>> validate_identifier("my_table")
        'my_table'
        >>> validate_identifier("'; DROP TABLE users; --")  # raises SQLValidationError
    """
    if not identifier or not identifier.strip():
        raise SQLValidationError("Identifier cannot be empty")

    identifier = identifier.strip()

    if len(identifier) > max_length:
        raise SQLValidationError(f"Identifier exceeds maximum length of {max_length}")

    # PostgreSQL identifiers: start with letter or underscore,
    # contain letters, digits, underscores, dollar signs
    # Also allow dots for schema.table notation
    if not re.match(
        r"^[a-zA-Z_][a-zA-Z0-9_$]*(\.[a-zA-Z_][a-zA-Z0-9_$]*)?$", identifier
    ):
        raise SQLValidationError(
            f"Invalid identifier '{identifier}'. "
            "Identifiers must start with a letter or underscore and contain only "
            "letters, digits, underscores, and dollar signs."
        )

    return identifier


def safe_identifier(identifier: str) -> sql.Identifier:
    """Create a safely escaped SQL identifier.

    Uses psycopg2's sql.Identifier for proper escaping.

    Args:
        identifier: The identifier to escape

    Returns:
        A psycopg2 sql.Identifier object

    Raises:
        SQLValidationError: If the identifier is invalid
    """
    validated = validate_identifier(identifier)
    return sql.Identifier(validated)


def safe_schema_table(schema: str, table: str) -> sql.Composed:
    """Create a safely escaped schema.table reference.

    Args:
        schema: Schema name
        table: Table name

    Returns:
        A psycopg2 sql.Composed object representing schema.table

    Examples:
        >>> query = sql.SQL("SELECT * FROM {}").format(safe_schema_table("public", "users"))
    """
    return sql.SQL("{}.{}").format(safe_identifier(schema), safe_identifier(table))


def sanitize_limit(limit: int, max_limit: int = 1000, default: int = 100) -> int:
    """Sanitize a LIMIT parameter to prevent DoS.

    Args:
        limit: Requested limit
        max_limit: Maximum allowed limit
        default: Default value if limit is invalid

    Returns:
        Sanitized limit between 1 and max_limit
    """
    if not isinstance(limit, int) or limit < 1:
        return default
    return min(limit, max_limit)
