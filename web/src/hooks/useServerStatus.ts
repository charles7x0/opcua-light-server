import { useQuery } from '@tanstack/react-query';
import { getServerStatus, type ServerStatus } from '../api';

/**
 * Centralized hook for server status data.
 * Single source of truth for query key and configuration.
 */
export function useServerStatus() {
  return useQuery<ServerStatus>({
    queryKey: ['serverStatus'],
    queryFn: getServerStatus,
    retry: 1,
  });
}
