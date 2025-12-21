/**
 * Utility functions for PostgreSQL MCP Server
 */

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return 'N/A';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format count with commas for readability
 */
export function formatCount(count: number | null | undefined): string {
  if (count === null || count === undefined) {
    return 'N/A';
  }
  return count.toLocaleString();
}

/**
 * Create a "not found" response object
 */
export function notFoundResponse(type: string, identifier: string): Record<string, unknown> {
  return {
    error: `${type} '${identifier}' not found`,
    found: false,
  };
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(date: Date | string | null | undefined): string | null {
  if (!date) {
    return null;
  }
  if (date instanceof Date) {
    return date.toISOString();
  }
  return String(date);
}

