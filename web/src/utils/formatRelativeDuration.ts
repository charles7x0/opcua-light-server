/**
 * Format an ISO 8601 timestamp as a human-readable relative duration from now.
 *
 * Returns the two largest meaningful time units (e.g., "3d 4h", "2h 15m", "5m 30s").
 * Handles edge cases:
 * - Future timestamps or < 1 second elapsed → "just now"
 * - Very long durations → includes days (e.g., "45d 6h")
 */
export function formatRelativeDuration(isoTimestamp: string): string {
  const elapsed = Date.now() - new Date(isoTimestamp).getTime();

  if (elapsed < 1000) {
    return 'just now';
  }

  const totalSeconds = Math.floor(elapsed / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  // Return the two largest meaningful units
  if (parts.length === 0) {
    return 'just now';
  }

  return parts.slice(0, 2).join(' ');
}
