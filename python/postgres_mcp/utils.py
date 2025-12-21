"""Utility functions for PostgreSQL MCP Server."""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, Optional


def truncate_string(text: Optional[str], max_length: int = 100) -> str:
    """Truncate a string to specified length with ellipsis.
    
    Args:
        text: Text to truncate (can be None)
        max_length: Maximum length including ellipsis
        
    Returns:
        Truncated string, or empty string if input is None
        
    Examples:
        >>> truncate_string("Hello World", 5)
        'He...'
        >>> truncate_string(None)
        ''
    """
    if not text:
        return ""
    if len(text) <= max_length:
        return text
    return text[:max_length - 3] + "..."


def format_bytes(num_bytes: Optional[int]) -> str:
    """Format bytes as human-readable string.
    
    Args:
        num_bytes: Number of bytes (can be None)
        
    Returns:
        Formatted string like "1.5 MB"
        
    Examples:
        >>> format_bytes(1024)
        '1.0 KB'
        >>> format_bytes(1048576)
        '1.0 MB'
    """
    if num_bytes is None:
        return "unknown"
    
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:.1f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.1f} PB"


def format_count(count: Optional[int]) -> str:
    """Format a count with K/M suffix for readability.
    
    Args:
        count: Number to format (can be None)
        
    Returns:
        Formatted string like "1.5M"
        
    Examples:
        >>> format_count(1500)
        '1.5K'
        >>> format_count(1500000)
        '1.5M'
    """
    if count is None:
        return "unknown"
    
    if count < 1000:
        return str(count)
    elif count < 1_000_000:
        return f"{count / 1000:.1f}K"
    else:
        return f"{count / 1_000_000:.1f}M"


def not_found_response(resource: str, identifier: str) -> dict[str, Any]:
    """Standard response for not-found resources.
    
    Args:
        resource: Resource type name (e.g., "Table", "Schema")
        identifier: Resource identifier
        
    Returns:
        Dict with error message
        
    Example:
        >>> not_found_response("Table", "users")
        {'error': "Table 'users' not found"}
    """
    return {"error": f"{resource} '{identifier}' not found"}


def handle_db_error(func: Callable[..., dict[str, Any]]) -> Callable[..., dict[str, Any]]:
    """Decorator to handle database errors consistently.
    
    Wraps a function to catch database exceptions and return
    a standardized error response instead of raising.
    
    Args:
        func: Function that may raise database errors
        
    Returns:
        Wrapped function that returns {"success": False, "error": str} on error
    """
    import psycopg2
    from postgres_mcp.security import SQLValidationError
    
    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> dict[str, Any]:
        try:
            return func(*args, **kwargs)
        except SQLValidationError as e:
            return {"success": False, "error": f"Validation error: {str(e)}"}
        except psycopg2.OperationalError as e:
            return {"success": False, "error": f"Connection error: {str(e)}"}
        except psycopg2.ProgrammingError as e:
            return {"success": False, "error": f"SQL error: {str(e)}"}
        except psycopg2.Error as e:
            return {"success": False, "error": f"Database error: {str(e)}"}
        except Exception as e:
            return {"success": False, "error": f"Unexpected error: {str(e)}"}
    
    return wrapper

